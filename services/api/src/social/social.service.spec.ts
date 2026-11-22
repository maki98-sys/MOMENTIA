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
 it('does not remove a reaction when the caller cannot view the post',async()=>{
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.removeReaction('u1','private-post')).rejects.toBeInstanceOf(NotFoundException);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain('SELECT 1 FROM posts');
 });
 it('authorizes visibility before deleting a reaction',async()=>{
  query.mockResolvedValueOnce({rowCount:1,rows:[{'?column?':1}]}).mockResolvedValueOnce({rowCount:1,rows:[]});
  await expect(service.removeReaction('u1','visible-post')).resolves.toEqual({removed:true});
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[1][0]).toContain('DELETE FROM content_reactions');
 });
 it('returns comments even when the author has no profile row',async()=>{
  query.mockResolvedValueOnce({rowCount:1,rows:[{'?column?':1}]}).mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.comments('u1','visible-post')).resolves.toEqual([]);
  expect(query.mock.calls[1][0]).toContain('LEFT JOIN user_profiles');
 });

 it('creates an accepted relationship for a public profile',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'u2',visibility:'public'}]})
   .mockResolvedValueOnce({rowCount:1,rows:[{requester_id:'u1',target_id:'u2',state:'accepted'}]});
  transaction.mockImplementation(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.follow('u1','u2')).resolves.toMatchObject({state:'accepted'});
  expect(clientQuery).toHaveBeenCalledTimes(2);
  expect(clientQuery.mock.calls[1][0]).toContain('ON CONFLICT(requester_id,target_id)');
 });
 it('creates a pending request for a non-public profile',async()=>{
  const clientQuery=jest.fn()
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
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'u2'}]})
   .mockResolvedValueOnce({rowCount:1,rows:[]})
   .mockResolvedValueOnce({rowCount:2,rows:[]});
  transaction.mockImplementation(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.block('u1','u2')).resolves.toEqual({blocked:true});
  expect(clientQuery).toHaveBeenCalledTimes(3);
  expect(clientQuery.mock.calls[2][0]).toContain('DELETE FROM user_relationships');
 });
 it('rejects accepting a request that is not pending for the current user',async()=>{
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.respondToFollowRequest('u1','u2','accepted')).rejects.toBeInstanceOf(NotFoundException);
 });

 it('does not create a request for a fully private profile',async()=>{
  const clientQuery=jest.fn().mockResolvedValueOnce({rowCount:1,rows:[{id:'u2',visibility:'private'}]});
  transaction.mockImplementation(async(fn:any)=>fn({query:clientQuery}));
  await expect(service.follow('u1','u2')).rejects.toBeInstanceOf(NotFoundException);
  expect(clientQuery).toHaveBeenCalledTimes(1);
 });
 it('filters comments authored by users blocked in either direction',async()=>{
  query.mockResolvedValueOnce({rowCount:1,rows:[{'?column?':1}]}).mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.comments('u1','visible-post')).resolves.toEqual([]);
  expect(query.mock.calls[1][0]).toContain('NOT EXISTS (SELECT 1 FROM user_blocks');
  expect(query.mock.calls[1][1]).toEqual(['visible-post','u1']);
 });
 it('rejects reactions to comments from blocked authors',async()=>{
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.reactToComment('u1','blocked-comment','like')).rejects.toBeInstanceOf(NotFoundException);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain('user_blocks');
 });
 it('rejects reaction removal against comments from blocked authors',async()=>{
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.removeCommentReaction('u1','blocked-comment')).rejects.toBeInstanceOf(NotFoundException);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain('user_blocks');
 });

});
