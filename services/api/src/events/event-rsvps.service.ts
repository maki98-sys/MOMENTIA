import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class EventRsvpsService {
  constructor(private readonly db: DatabaseService) {}

  async respond(userId: string, spaceId: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('RSVP data is required.');
    const value=input as Record<string,unknown>;
    if (Object.keys(value).some(k=>!['response','guestCount','note'].includes(k))) throw new BadRequestException('Unsupported RSVP fields.');
    if (!['going','interested','declined'].includes(String(value.response))) throw new BadRequestException('response must be going, interested or declined.');
    const guestCount=value.guestCount??0;
    if (!Number.isInteger(guestCount)||Number(guestCount)<0||Number(guestCount)>20) throw new BadRequestException('guestCount must be between 0 and 20.');
    const note=value.note??null;
    if (note!==null&&(typeof note!=='string'||note.length>500)) throw new BadRequestException('note must be at most 500 characters.');
    if (value.response!=='going'&&Number(guestCount)!==0) throw new BadRequestException('Only a going RSVP can include guests.');
    return this.db.transaction(async client=>{
      const event=await client.query(
        `SELECT s.id,ed.starts_at,ed.ends_at,sm.role
         FROM spaces s JOIN event_details ed ON ed.space_id=s.id
         JOIN space_memberships sm ON sm.space_id=s.id AND sm.user_id=$1 AND sm.state='active'
         WHERE s.id=$2 AND s.type='EVENT' AND s.status='active' FOR SHARE OF s,ed,sm`,
        [userId,spaceId]);
      if(!event.rowCount) throw new NotFoundException('Event not found.');
      if(event.rows[0].ends_at && new Date(String(event.rows[0].ends_at)).getTime()<Date.now()) {
        throw new BadRequestException('This event has already ended.');
      }
      const result=await client.query(
        `INSERT INTO event_rsvps(space_id,user_id,response,guest_count,note)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(space_id,user_id) DO UPDATE SET
           response=EXCLUDED.response,guest_count=EXCLUDED.guest_count,
           note=EXCLUDED.note,responded_at=now()
         RETURNING id,space_id,user_id,response,guest_count,note,responded_at`,
        [spaceId,userId,value.response,guestCount,note]);
      await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id,metadata)
         VALUES($1,$2,'event.rsvp_updated','event_rsvp',$3,jsonb_build_object('response',$4,'guestCount',$5))`,
        [spaceId,userId,result.rows[0].id,value.response,guestCount]);
      return result.rows[0];
    });
  }

  async summary(userId: string, spaceId: string) {
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))");
      const access=await client.query(
        `SELECT sm.role FROM spaces s
         JOIN space_memberships sm ON sm.space_id=s.id AND sm.user_id=$1 AND sm.state='active'
         WHERE s.id=$2 AND s.type='EVENT' AND s.status IN ('active','archived')`,
        [userId,spaceId]);
      if(!access.rowCount) throw new NotFoundException('Event not found.');
      const counts=await client.query(
        `SELECT count(*) FILTER(WHERE r.response='going')::int going,
                count(*) FILTER(WHERE r.response='interested')::int interested,
                count(*) FILTER(WHERE r.response='declined')::int declined,
                COALESCE(sum(r.guest_count) FILTER(WHERE r.response='going'),0)::int additional_guests
         FROM event_rsvps r JOIN users u ON u.id=r.user_id AND u.status='active'
         WHERE r.space_id=$1`,[spaceId]);
      const result={...counts.rows[0]};
      if(['owner','admin','moderator'].includes(String(access.rows[0].role))) {
        const attendees=await client.query(
          `SELECT r.user_id,up.display_name,r.response,r.guest_count,r.note,r.responded_at
           FROM event_rsvps r JOIN users u ON u.id=r.user_id AND u.status='active'
           LEFT JOIN user_profiles up ON up.user_id=r.user_id
           WHERE r.space_id=$1 ORDER BY
             CASE r.response WHEN 'going' THEN 0 WHEN 'interested' THEN 1 ELSE 2 END,
             r.responded_at DESC`,[spaceId]);
        return {...result,attendees:attendees.rows};
      }
      return result;
    });
  }

  async remove(userId: string, spaceId: string) {
    const result=await this.db.query(
      `DELETE FROM event_rsvps r USING spaces s,space_memberships sm
       WHERE r.space_id=$1 AND r.user_id=$2
         AND s.id=r.space_id AND s.type='EVENT'
         AND sm.space_id=s.id AND sm.user_id=$2 AND sm.state='active'
       RETURNING r.id`,[spaceId,userId]);
    if(!result.rowCount) throw new NotFoundException('RSVP not found.');
    return {removed:true};
  }
}
