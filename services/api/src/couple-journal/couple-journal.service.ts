import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CoupleJournalService {
 constructor(private readonly db:DatabaseService){}
 private decode(value:unknown,min:number,max:number,label:string):Buffer{
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new BadRequestException(label+' must be base64.');
  const b=Buffer.from(value,'base64');
  if(b.toString('base64')!==value||b.length<min||b.length>max) throw new BadRequestException(label+' has an invalid length or encoding.');
  return b;
 }
 private async assertCouple(client:any,spaceId:string,userId:string){
  const r=await client.query(
   `SELECT s.id FROM spaces s
    JOIN space_memberships mine ON mine.space_id=s.id AND mine.user_id=$2 AND mine.state='active'
    WHERE s.id=$1 AND s.type='COUPLE' AND s.status='active'
      AND (SELECT count(*) FROM space_memberships m WHERE m.space_id=s.id AND m.state='active')=2
    FOR UPDATE OF s`,[spaceId,userId]);
  if(!r.rowCount) throw new NotFoundException('Couple space not found.');
 }
 async list(spaceId:string,userId:string,limit=30){
  const n=Math.min(Math.max(Number(limit)||30,1),100);
  return this.db.transaction(async client=>{
   await this.assertCouple(client,spaceId,userId);
   const r=await client.query(
    `SELECT id,author_id,ciphertext,nonce,encryption_version,key_version,created_at,updated_at
     FROM couple_journal_entries WHERE space_id=$1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT $2`,[spaceId,n]);
   return r.rows.map(x=>({...x,ciphertext:Buffer.from(x.ciphertext).toString('base64'),nonce:Buffer.from(x.nonce).toString('base64')}));
  });
 }
 async create(spaceId:string,userId:string,input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Encrypted journal payload is required.');
  const v=input as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['ciphertext','nonce','encryptionVersion','keyVersion'].includes(k))) throw new BadRequestException('Unsupported journal fields.');
  const ciphertext=this.decode(v.ciphertext,1,65536,'ciphertext');
  const nonce=this.decode(v.nonce,12,24,'nonce');
  if(v.encryptionVersion!==undefined&&v.encryptionVersion!==1) throw new BadRequestException('Unsupported encryption version.');
  const keyVersion=v.keyVersion===undefined?1:Number(v.keyVersion);
  if(!Number.isSafeInteger(keyVersion)||keyVersion<1||keyVersion>1000000) throw new BadRequestException('Invalid journal key version.');
  return this.db.transaction(async client=>{
   await this.assertCouple(client,spaceId,userId);
   const id=randomUUID();
   const r=await client.query(
    `INSERT INTO couple_journal_entries(id,space_id,author_id,ciphertext,nonce,encryption_version,key_version)
     VALUES($1,$2,$3,$4,$5,1,$6)
     RETURNING id,author_id,key_version,created_at,updated_at`,[id,spaceId,userId,ciphertext,nonce,keyVersion]);
   return r.rows[0];
  });
 }
 async remove(spaceId:string,entryId:string,userId:string){
  return this.db.transaction(async client=>{
   await this.assertCouple(client,spaceId,userId);
   const r=await client.query(
    `UPDATE couple_journal_entries SET deleted_at=now(),updated_at=now()
     WHERE id=$1 AND space_id=$2 AND author_id=$3 AND deleted_at IS NULL
     RETURNING id`,[entryId,spaceId,userId]);
   if(!r.rowCount) throw new NotFoundException('Journal entry not found.');
   return {deleted:true,id:r.rows[0].id};
  });
 }
 async putKeyEnvelope(spaceId:string,userId:string,input:unknown) {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Key envelope is required.');
  const v=input as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['keyVersion','algorithm','encryptedKey','nonce'].includes(k))) throw new BadRequestException('Unsupported key envelope fields.');
  const keyVersion=Number(v.keyVersion);
  if(!Number.isSafeInteger(keyVersion)||keyVersion<1||keyVersion>1000000) throw new BadRequestException('Invalid key version.');
  if(!['X25519-HKDF-SHA256-AES256GCM','P256-HKDF-SHA256-AES256GCM'].includes(String(v.algorithm))) throw new BadRequestException('Unsupported key envelope algorithm.');
  const encryptedKey=this.decode(v.encryptedKey,32,4096,'encryptedKey');
  const nonce=this.decode(v.nonce,12,24,'nonce');
  return this.db.transaction(async client=>{
   await this.assertCouple(client,spaceId,userId);
   const result=await client.query(
    `INSERT INTO couple_space_key_envelopes(space_id,user_id,key_version,algorithm,encrypted_key,nonce)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(space_id,user_id,key_version) DO UPDATE SET
       algorithm=EXCLUDED.algorithm,encrypted_key=EXCLUDED.encrypted_key,nonce=EXCLUDED.nonce,updated_at=now()
     RETURNING id,space_id,user_id,key_version,algorithm,created_at,updated_at`,
    [spaceId,userId,keyVersion,v.algorithm,encryptedKey,nonce]);
   await client.query(
    `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id,metadata)
     VALUES($1,$2,'couple.journal_key_envelope.updated','couple_key',$3,$4::jsonb)`,
    [spaceId,userId,result.rows[0].id,JSON.stringify({keyVersion,algorithm:v.algorithm})]);
   return result.rows[0];
  });
 }

 async getKeyEnvelope(spaceId:string,userId:string,keyVersion?:string) {
  const version=keyVersion===undefined?undefined:Number(keyVersion);
  if(version!==undefined&&(!Number.isSafeInteger(version)||version<1)) throw new BadRequestException('Invalid key version.');
  return this.db.transaction(async client=>{
   await this.assertCouple(client,spaceId,userId);
   const result=await client.query(
    `SELECT key_version,algorithm,encrypted_key,nonce,created_at,updated_at
     FROM couple_space_key_envelopes
     WHERE space_id=$1 AND user_id=$2 AND ($3::integer IS NULL OR key_version=$3)
     ORDER BY key_version DESC LIMIT 1`,[spaceId,userId,version??null]);
   if(!result.rowCount) return {envelope:null};
   const row=result.rows[0];
   return {envelope:{...row,encrypted_key:Buffer.from(row.encrypted_key).toString('base64'),nonce:Buffer.from(row.nonce).toString('base64')}};
  });
 }

}
