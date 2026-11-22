import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CoupleInvitationsService {
  constructor(private readonly db: DatabaseService) {}

  validateCreateInput(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('A couple invitation object is required.');
    }
    const body=value as Record<string,unknown>;
    if(Object.keys(body).some(key=>key!=='inviteeUserId')) {
      throw new BadRequestException('Unsupported couple invitation fields.');
    }
    const id=body.inviteeUserId;
    if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('inviteeUserId must be a valid user UUID.');
    }
    return id;
  }

  async create(inviterId:string,inviteeId:string) {
    if(inviterId===inviteeId) throw new BadRequestException('You cannot invite yourself to a couple space.');
    const token=randomBytes(32).toString('base64url');
    const hash=createHash('sha256').update(token).digest('hex');
    const result=await this.db.transaction(async client=>{
      const users=await client.query(
        `SELECT id FROM users WHERE id=ANY($1::uuid[]) AND status='active' FOR SHARE`,
        [[inviterId,inviteeId]]);
      if(users.rowCount!==2) throw new NotFoundException('An active account could not be found.');
      await client.query(
        `UPDATE couple_space_invitations SET revoked_at=now()
         WHERE inviter_user_id=$1 AND invitee_user_id=$2
           AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=now()`,
        [inviterId,inviteeId]);
      const existing=await client.query(
        `SELECT id FROM couple_space_invitations
         WHERE inviter_user_id=$1 AND invitee_user_id=$2
           AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()
         LIMIT 1 FOR UPDATE`,[inviterId,inviteeId]);
      if(existing.rowCount) throw new BadRequestException('A pending invitation already exists for this account.');
      const created=await client.query(
        `INSERT INTO couple_space_invitations(inviter_user_id,invitee_user_id,token_hash,expires_at)
         VALUES($1,$2,$3,now()+interval '7 days')
         RETURNING id,invitee_user_id,expires_at,created_at`,
        [inviterId,inviteeId,hash]);
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$2,'couple.invitation.created','couple_invitation',$3,jsonb_build_object('expiresAt',$4))`,
        [inviterId,inviteeId,created.rows[0].id,created.rows[0].expires_at]);
      return created.rows[0];
    });
    return {...result,token};
  }

  async list(userId:string) {
    const result=await this.db.query(
      `SELECT i.id,i.inviter_user_id,i.invitee_user_id,i.expires_at,i.accepted_at,i.revoked_at,i.created_at,
              CASE WHEN i.invitee_user_id=$1 THEN 'incoming' ELSE 'outgoing' END AS direction
       FROM couple_space_invitations i
       WHERE (i.inviter_user_id=$1 OR i.invitee_user_id=$1)
       ORDER BY i.created_at DESC LIMIT 100`,[userId]);
    return result.rows;
  }

  async revoke(userId:string,invitationId:string) {
    return this.db.transaction(async client=>{
      const result=await client.query(
        `UPDATE couple_space_invitations SET revoked_at=now()
         WHERE id=$2 AND inviter_user_id=$1 AND accepted_at IS NULL
           AND revoked_at IS NULL AND expires_at>now()
         RETURNING id,invitee_user_id,revoked_at`,[userId,invitationId]);
      if(!result.rowCount) throw new NotFoundException('Pending couple invitation not found.');
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id)
         VALUES($1,$2,'couple.invitation.revoked','couple_invitation',$3)`,
        [userId,result.rows[0].invitee_user_id,invitationId]);
      return result.rows[0];
    });
  }

  async accept(userId:string,token:string) {
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new BadRequestException('The couple invitation token is invalid.');
    }
    const hash=createHash('sha256').update(token).digest('hex');
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const found=await client.query(
        `SELECT id,inviter_user_id,invitee_user_id,expires_at,accepted_at,revoked_at
         FROM couple_space_invitations WHERE token_hash=$1 FOR UPDATE`,[hash]);
      if(!found.rowCount) throw new NotFoundException('Couple invitation is invalid or unavailable.');
      const invite=found.rows[0] as Record<string,unknown>;
      if(invite.invitee_user_id!==userId) throw new ForbiddenException('This invitation belongs to another account.');
      if(invite.accepted_at||invite.revoked_at||new Date(String(invite.expires_at)).getTime()<=Date.now()) {
        throw new NotFoundException('Couple invitation is invalid or unavailable.');
      }
      // Serialize accepts for either account in a deterministic order. Without these
      // row locks, two different pending invitations could concurrently create
      // two active couple spaces for the same user pair.
      const lockedUsers=await client.query(
        `SELECT id FROM users WHERE id=ANY($1::uuid[]) AND status='active' ORDER BY id FOR UPDATE`,
        [[invite.inviter_user_id,userId]]);
      if(lockedUsers.rowCount!==2) throw new NotFoundException('An active account could not be found.');
      const occupied=await client.query(
        `SELECT s.id FROM spaces s JOIN space_memberships sm ON sm.space_id=s.id
         WHERE s.type='COUPLE' AND s.status='active' AND sm.user_id=ANY($1::uuid[]) AND sm.state='active'
         LIMIT 1 FOR UPDATE OF s`,[[invite.inviter_user_id,userId]]);
      if(occupied.rowCount) throw new BadRequestException('One of these accounts already belongs to an active couple space.');
      const ownerPlan=await client.query(
        `SELECT p.features,COALESCE((p.features->>'max_spaces')::integer,5) max_spaces,
                (SELECT count(*)::integer FROM spaces s
                 WHERE s.owner_id=$1 AND s.status IN ('active','archived')) owned_spaces
         FROM subscription_plans p
         LEFT JOIN LATERAL (
           SELECT us.plan_id FROM user_subscriptions us
           WHERE us.user_id=$1 AND us.status IN ('trialing','active','past_due')
             AND (us.current_period_end IS NULL OR us.current_period_end>now())
           ORDER BY CASE us.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 ELSE 2 END,
                    us.created_at DESC LIMIT 1
         ) sub ON sub.plan_id=p.id
         WHERE p.id=COALESCE(sub.plan_id,(SELECT id FROM subscription_plans WHERE code='free'))`,
        [invite.inviter_user_id]);
      if(!ownerPlan.rowCount) throw new BadRequestException('The inviter subscription plan could not be resolved.');
      const plan=ownerPlan.rows[0];
      if(plan.features?.couple_journal===false) throw new ForbiddenException('Couple spaces are not included in the inviter current plan.');
      if(Number(plan.owned_spaces)>=Number(plan.max_spaces)) throw new ForbiddenException('The inviter has reached the maximum number of spaces allowed by the current plan.');
      const created=await client.query(
        `INSERT INTO spaces(type,owner_id,name,visibility)
         VALUES('COUPLE',$1,'Nuestro espacio','private')
         RETURNING id`,[invite.inviter_user_id]);
      const spaceId=String(created.rows[0].id);
      await client.query(
        `INSERT INTO couple_details(space_id) VALUES($1)`,[spaceId]);
      await client.query(
        `INSERT INTO space_memberships(space_id,user_id,role,state,joined_at)
         VALUES($1,$2,'owner','active',now()),($1,$3,'member','active',now())`,
        [spaceId,invite.inviter_user_id,userId]);
      await client.query(
        `UPDATE couple_space_invitations SET accepted_at=now() WHERE id=$1`,[invite.id]);
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$2,'couple.space.created','space',$3,jsonb_build_object('invitationId',$4))`,
        [userId,invite.inviter_user_id,spaceId,invite.id]);
      return {spaceId,type:'COUPLE',visibility:'private',members:[invite.inviter_user_id,userId]};
    });
  }
}
