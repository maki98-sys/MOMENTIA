import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGETS=['user','post','comment','space','media'] as const;
const REASONS=['spam','harassment','hate','violence','sexual_content','impersonation','copyright','privacy','fraud','other'] as const;
type Target=typeof TARGETS[number];

@Injectable()
export class ModerationService {
  constructor(private readonly db:DatabaseService) {}

  private isModerator(userId:string):boolean {
    const ids=(process.env.MOMENTIA_MODERATOR_USER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
    return ids.includes(userId);
  }

  private validateReport(input:unknown) {
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Report data is required.');
    const v=input as Record<string,unknown>;
    if(Object.keys(v).some(k=>!['targetType','targetId','reason','details'].includes(k))) throw new BadRequestException('Unsupported report fields.');
    if(!TARGETS.includes(v.targetType as Target)) throw new BadRequestException('Unsupported report target type.');
    if(typeof v.targetId!=='string'||!UUID.test(v.targetId)) throw new BadRequestException('targetId must be a UUID.');
    if(!REASONS.includes(v.reason as typeof REASONS[number])) throw new BadRequestException('Unsupported report reason.');
    if(v.details!==undefined&&(typeof v.details!=='string'||v.details.length>2000)) throw new BadRequestException('details must not exceed 2000 characters.');
    return v as {targetType:Target;targetId:string;reason:string;details?:string};
  }

  async submit(reporterId:string,input:unknown) {
    const v=this.validateReport(input);
    if(v.targetType==='user'&&v.targetId===reporterId) throw new BadRequestException('You cannot report your own account.');
    return this.db.transaction(async client=>{
      const table:Record<Target,string>={user:'users',post:'posts',comment:'post_comments',space:'spaces',media:'media_assets'};
      const found=await client.query(`SELECT 1 FROM ${table[v.targetType]} WHERE id=$1`,[v.targetId]);
      if(!found.rowCount) throw new NotFoundException('Report target not found.');
      const prior=await client.query(`SELECT id FROM user_reports WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 AND status IN ('open','reviewing') LIMIT 1`,[reporterId,v.targetType,v.targetId]);
      if(prior.rowCount) throw new BadRequestException('You already have an open report for this target.');
      const created=await client.query(`INSERT INTO user_reports(reporter_id,target_type,target_id,reason,details) VALUES($1,$2,$3,$4,$5) RETURNING id,target_type,target_id,reason,status,created_at`,[reporterId,v.targetType,v.targetId,v.reason,v.details??null]);
      await client.query(`INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata) VALUES($1,NULL,'moderation.report.submitted','report',$2,jsonb_build_object('targetType',$3,'reason',$4))`,[reporterId,created.rows[0].id,v.targetType,v.reason]);
      return created.rows[0];
    });
  }

  async listMine(userId:string,limit=30) {
    const n=Math.min(Math.max(Number(limit)||30,1),100);
    const r=await this.db.query(`SELECT id,target_type,target_id,reason,details,status,created_at,resolved_at FROM user_reports WHERE reporter_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,[userId,n]);
    return r.rows;
  }

  async queue(userId:string,status='open',limit=50) {
    this.assertModerator(userId);
    if(!['open','reviewing','resolved','dismissed','all'].includes(status)) throw new BadRequestException('Invalid report status filter.');
    const n=Math.min(Math.max(Number(limit)||50,1),100);
    const r=await this.db.query(`SELECT r.id,r.reporter_id,r.target_type,r.target_id,r.reason,r.details,r.status,r.assigned_to,r.created_at,r.resolved_at
      FROM user_reports r WHERE ($1='all' OR r.status=$1) ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,r.created_at ASC LIMIT $2`,[status,n]);
    return r.rows;
  }

  private assertModerator(userId:string) {
    if(!this.isModerator(userId)) throw new ForbiddenException('Platform moderator permission is required.');
  }

  async review(userId:string,reportId:string,input:unknown) {
    this.assertModerator(userId);
    if(!UUID.test(reportId)) throw new BadRequestException('reportId must be a UUID.');
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Review data is required.');
    const v=input as Record<string,unknown>;
    if(Object.keys(v).some(k=>!['decision','action','note'].includes(k))) throw new BadRequestException('Unsupported review fields.');
    if(!['reviewing','resolve','dismiss'].includes(String(v.decision))) throw new BadRequestException('Invalid moderation decision.');
    if(v.action!==undefined&&!['none','hide','restore','suspend_user','unsuspend_user','remove_media'].includes(String(v.action))) throw new BadRequestException('Invalid moderation action.');
    if(v.note!==undefined&&(typeof v.note!=='string'||v.note.length>2000)) throw new BadRequestException('note must not exceed 2000 characters.');
    return this.db.transaction(async client=>{
      const found=await client.query(`SELECT * FROM user_reports WHERE id=$1 FOR UPDATE`,[reportId]);
      if(!found.rowCount) throw new NotFoundException('Report not found.');
      const report=found.rows[0] as Record<string,any>;
      if(['resolved','dismissed'].includes(report.status)) throw new BadRequestException('This report is already closed.');
      const action=String(v.action??'none');
      if(action!=='none') await this.applyAction(client,report.target_type as Target,String(report.target_id),action);
      const next= v.decision==='reviewing'?'reviewing':v.decision==='resolve'?'resolved':'dismissed';
      const updated=await client.query(`UPDATE user_reports SET status=$2,assigned_to=$3,resolved_at=CASE WHEN $2 IN ('resolved','dismissed') THEN now() ELSE NULL END WHERE id=$1 RETURNING id,status,assigned_to,resolved_at`,[reportId,next,userId]);
      await client.query(`INSERT INTO moderation_audit_events(moderator_id,report_id,target_type,target_id,decision,action,note) VALUES($1,$2,$3,$4,$5,$6,$7)`,[userId,reportId,report.target_type,report.target_id,next,action,v.note??null]);
      return updated.rows[0];
    });
  }

  private async applyAction(client:{query:(sql:string,values?:unknown[])=>Promise<any>},target:Target,id:string,action:string) {
    if(action==='hide'||action==='restore') {
      const states:Record<string,{table:string;column:string;hidden:string;visible:string}> = {
        post:{table:'posts',column:'status',hidden:'hidden',visible:'published'},
        comment:{table:'post_comments',column:'status',hidden:'hidden',visible:'visible'},
        space:{table:'spaces',column:'status',hidden:'archived',visible:'active'},
      };
      const spec=states[target];
      if(!spec) throw new BadRequestException('Hide/restore is not supported for this target.');
      const value=action==='hide'?spec.hidden:spec.visible;
      const r=await client.query(`UPDATE ${spec.table} SET ${spec.column}=$2 WHERE id=$1 RETURNING id`,[id,value]);
      if(!r.rowCount) throw new NotFoundException('Moderation target not found.');
      return;
    }
    if(action==='suspend_user'||action==='unsuspend_user') {
      if(target!=='user') throw new BadRequestException('Account suspension applies only to users.');
      const r=await client.query(`UPDATE users SET status=$2 WHERE id=$1 AND status IN ('active','suspended') RETURNING id`,[id,action==='suspend_user'?'suspended':'active']);
      if(!r.rowCount) throw new NotFoundException('User target not found or cannot change status.');
      return;
    }
    if(action==='remove_media') {
      if(target!=='media') throw new BadRequestException('Media removal applies only to media targets.');
      const r=await client.query(`UPDATE media_assets SET status='deleted',deleted_at=now() WHERE id=$1 AND status<>'deleted' RETURNING id`,[id]);
      if(!r.rowCount) throw new NotFoundException('Media target not found or already deleted.');
    }
  }
}
