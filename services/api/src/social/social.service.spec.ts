import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocialService } from './social.service';
import { DatabaseService } from '../database/database.service';

describe('SocialService',()=>{
 const query=jest.fn(), transaction=jest.fn();
 const service=new SocialService({query,transaction} as unknown as DatabaseService);
 beforeEach(()=>{query.mockReset();transaction.mockReset();});
 it('rejects posts without text or media',async()=>{
  await expect(service.create('u1',{audience:'public'})).rejects.toBeInstanceOf(BadRequestException);
  expect(transaction).not.toHaveBeenCalled();
 });
 it('rejects unsupported fields and invalid audience',async()=>{
  await expect(service.create('u1',{body:'hello',isAdmin:true})).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.create('u1',{body:'hello',audience:'everyone'})).rejects.toBeInstanceOf(BadRequestException);
 });
 it('requires a space for space-only posts',async()=>{
  await expect(service.create('u1',{body:'hello',audience:'space'})).rejects.toBeInstanceOf(BadRequestException);
 });
 it('rejects empty and oversized comments',async()=>{
  await expect(service.addComment('u1','p1',' ')).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.addComment('u1','p1','x'.repeat(3001))).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
 });
 it('rejects unsupported reaction types',async()=>{
  await expect(service.react('u1','p1','admin')).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
 });
 it('rejects invalid feed cursors before querying PostgreSQL',async()=>{
  await expect(service.feed('u1','not-a-date')).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
 });
 it('uses a composite timestamp and UUID cursor for stable feed pagination',async()=>{
  const cursorId='00000000-0000-4000-8000-000000000099';
  const cursorAt='2026-11-21T10:00:00.000Z';
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.feed('u1',cursorAt+'|'+cursorId,10)).resolves.toEqual([]);
  expect(query.mock.calls[0][0]).toContain('(p.published_at,p.id)<($2::timestamptz,$3::uuid)');
  expect(query.mock.calls[0][1]).toEqual(['u1',cursorAt,cursorId,10]);
 });

 it('does not remove a reaction when the caller cannot view the post',async()=>{
  const clientQuery=jest.fn().mockResolvedValueOnce({rowCount:0,rows:[]}).mockResolvedValueOnce({rowCount:0,rows:[]});
  transaction.mockImplementationOnce(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.removeReaction('u1','private-post')).rejects.toBeInstanceOf(NotFoundException);
  expect(clientQuery).toHaveBeenCalledTimes(2);
  expect(clientQuery.mock.calls[1][0]).toContain('SELECT 1 FROM posts');
 });
 it('authorizes visibility before deleting a reaction',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{'?column?':1}]})
   .mockResolvedValueOnce({rowCount:1,rows:[]});
  transaction.mockImplementationOnce(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.removeReaction('u1','visible-post')).resolves.toEqual({removed:true});
  expect(clientQuery).toHaveBeenCalledTimes(3);
  expect(clientQuery.mock.calls[2][0]).toContain('DELETE FROM content_reactions');
 });
 it('returns comments even when the author has no profile row',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{'?column?':1}]})
   .mockResolvedValueOnce({rowCount:0,rows:[]});
  transaction.mockImplementationOnce(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.comments('u1','visible-post')).resolves.toEqual([]);
  expect(clientQuery.mock.calls[2][0]).toContain('LEFT JOIN user_profiles');
 });

 it('creates an accepted relationship for a public profile',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'u2',visibility:'public'}]})
   .mockResolvedValueOnce({rowCount:1,rows:[{requester_id:'u1',target_id:'u2',state:'accepted'}]});
  transaction.mockImplementation(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.follow('u1','u2')).resolves.toMatchObject({state:'accepted'});
  expect(clientQuery).toHaveBeenCalledTimes(3);
  expect(clientQuery.mock.calls[2][0]).toContain('ON CONFLICT(requester_id,target_id)');
 });
 it('creates a pending request for a non-public profile',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'u2',visibility:'followers'}]})
   .mockResolvedValueOnce({rowCount:1,rows:[{requester_id:'u1',target_id:'u2',state:'pending'}]});
  transaction.mockImplementation(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.follow('u1','u2')).resolves.toMatchObject({state:'pending'});
 });
 it('does not allow following oneself',async()=>{
  await expect(service.follow('u1','u1')).rejects.toBeInstanceOf(BadRequestException);
  expect(transaction).not.toHaveBeenCalled();
 });
 it('removes both directions of a relationship when blocking',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'u2'}]})
   .mockResolvedValueOnce({rowCount:1,rows:[]})
   .mockResolvedValueOnce({rowCount:2,rows:[]});
  transaction.mockImplementation(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.block('u1','u2')).resolves.toEqual({blocked:true});
  expect(clientQuery).toHaveBeenCalledTimes(4);
  expect(clientQuery.mock.calls[3][0]).toContain('DELETE FROM user_relationships');
 });
 it('rejects accepting a request that is not pending for the current user',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:0,rows:[]});
  transaction.mockImplementationOnce(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.respondToFollowRequest('u1','u2','accepted')).rejects.toBeInstanceOf(NotFoundException);
  expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  expect(clientQuery).toHaveBeenCalledTimes(2);
 });

 it('serializes unfollow with snapshot authorization reads',async()=>{
  const clientQuery=jest.fn().mockResolvedValueOnce({rows:[],rowCount:0});
  transaction.mockImplementationOnce(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.unfollow('u1','u2')).resolves.toEqual({following:false});
  expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  expect(clientQuery.mock.calls[1][0]).toContain('DELETE FROM user_relationships');
 });
 it('serializes unblock with snapshot authorization reads',async()=>{
  const clientQuery=jest.fn().mockResolvedValueOnce({rows:[],rowCount:0});
  transaction.mockImplementationOnce(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.unblock('u1','u2')).resolves.toEqual({blocked:false});
  expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  expect(clientQuery.mock.calls[1][0]).toContain('DELETE FROM user_blocks');
 });

 it('does not create a request for a fully private profile',async()=>{
  const clientQuery=jest.fn().mockResolvedValueOnce({rowCount:0,rows:[]}).mockResolvedValueOnce({rowCount:1,rows:[{id:'u2',visibility:'private'}]});
  transaction.mockImplementation(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.follow('u1','u2')).rejects.toBeInstanceOf(NotFoundException);
  expect(clientQuery).toHaveBeenCalledTimes(2);
 });
 it('filters comments authored by users blocked in either direction',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{'?column?':1}]})
   .mockResolvedValueOnce({rowCount:0,rows:[]});
  transaction.mockImplementationOnce(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.comments('u1','visible-post')).resolves.toEqual([]);
  expect(clientQuery.mock.calls[2][0]).toContain('NOT EXISTS (SELECT 1 FROM user_blocks');
  expect(clientQuery.mock.calls[2][0]).toContain("comment_author.status='active'");
  expect(clientQuery.mock.calls[2][1]).toEqual(['visible-post','u1']);
 });
 it('rejects reactions to comments from blocked authors',async()=>{
  const clientQuery=jest.fn().mockResolvedValueOnce({rowCount:0,rows:[]}).mockResolvedValueOnce({rowCount:0,rows:[]});
  transaction.mockImplementationOnce(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.reactToComment('u1','blocked-comment','like')).rejects.toBeInstanceOf(NotFoundException);
  expect(clientQuery).toHaveBeenCalledTimes(2);
  expect(clientQuery.mock.calls[1][0]).toContain('user_blocks');
 });
 it('rejects reaction removal against comments from blocked authors',async()=>{
  const clientQuery=jest.fn().mockResolvedValueOnce({rowCount:0,rows:[]}).mockResolvedValueOnce({rowCount:0,rows:[]});
  transaction.mockImplementationOnce(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.removeCommentReaction('u1','blocked-comment')).rejects.toBeInstanceOf(NotFoundException);
  expect(clientQuery).toHaveBeenCalledTimes(2);
  expect(clientQuery.mock.calls[1][0]).toContain('user_blocks');
 });


 it('rejects malformed connection cursors before querying PostgreSQL', async () => {
  await expect(service.listConnections('u1','followers','not-a-cursor',20)).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
 });
 it('returns cursor-paginated followers and filters blocked or inactive accounts', async () => {
  const createdAt='2026-11-22T10:00:00.000Z';
  query.mockResolvedValueOnce({rowCount:2,rows:[
   {relationship_id:'00000000-0000-4000-8000-000000000001',created_at:createdAt,user_id:'u2',display_name:'User 2',avatar_media_id:null},
   {relationship_id:'00000000-0000-4000-8000-000000000002',created_at:createdAt,user_id:'u3',display_name:'User 3',avatar_media_id:null},
  ]});
  const result=await service.listConnections('u1','followers',undefined,1);
  expect(result.users).toEqual([{userId:'u2',displayName:'User 2',avatarMediaId:null,createdAt}]);
  expect(result.hasMore).toBe(true);
  expect(result.nextCursor).toBeTruthy();
  expect(query.mock.calls[0][0]).toContain("u.status = 'active'");
  expect(query.mock.calls[0][0]).toContain('NOT EXISTS');
  expect(query.mock.calls[0][0]).toContain("(r.created_at, r.id) < ($3::timestamptz, $4::uuid)");
  expect(query.mock.calls[0][1]).toEqual(['u1','followers',null,null,2]);
 });
 it('supports following and incoming-request list filters with stable cursor ordering', async () => {
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.listConnections('u1','following')).resolves.toMatchObject({users:[],hasMore:false,nextCursor:null});
  expect(query.mock.calls[0][0]).toContain("r.requester_id = $1 AND r.state = 'accepted'");
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.listConnections('u1','requests')).resolves.toMatchObject({users:[],hasMore:false,nextCursor:null});
  expect(query.mock.calls[1][0]).toContain("r.target_id = $1 AND r.state = 'pending'");
 });
 it('rejects connection list limits outside the supported range', async () => {
  await expect(service.listConnections('u1','followers',undefined,51)).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
 });

});
