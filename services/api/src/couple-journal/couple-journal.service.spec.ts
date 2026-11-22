import { BadRequestException } from '@nestjs/common';
import { CoupleJournalService } from './couple-journal.service';
import { DatabaseService } from '../database/database.service';
describe('CoupleJournalService',()=>{
 const service=new CoupleJournalService({} as DatabaseService);
 it('rejects non-base64 encrypted payloads',async()=>{
  await expect(service.create('space','user',{ciphertext:'plain text',nonce:Buffer.alloc(12).toString('base64')})).rejects.toBeInstanceOf(BadRequestException);
 });
 it('rejects malformed nonce lengths',async()=>{
  await expect(service.create('space','user',{ciphertext:Buffer.from('x').toString('base64'),nonce:Buffer.alloc(4).toString('base64')})).rejects.toBeInstanceOf(BadRequestException);
 });
 it('audits encrypted journal entry creation',async()=>{
  const transaction=jest.fn();
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rows:[{enabled:true}],rowCount:1})
   .mockResolvedValueOnce({rows:[{id:'space'}],rowCount:1})
   .mockResolvedValueOnce({rows:[{total:2}],rowCount:1})
   .mockResolvedValueOnce({rows:[{id:'entry',author_id:'user',key_version:1}],rowCount:1})
   .mockResolvedValueOnce({rows:[],rowCount:1});
  transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
  const audited=new CoupleJournalService({transaction} as unknown as DatabaseService);
  await expect(audited.create('space','user',{
   ciphertext:Buffer.alloc(16).toString('base64'),nonce:Buffer.alloc(12).toString('base64'),
  })).resolves.toMatchObject({id:'entry'});
  expect(clientQuery.mock.calls[4][0]).toContain('couple.journal_entry.created');
 });

 it('audits encrypted journal entry deletion',async()=>{
  const transaction=jest.fn();
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rows:[{enabled:true}],rowCount:1})
   .mockResolvedValueOnce({rows:[{id:'space'}],rowCount:1})
   .mockResolvedValueOnce({rows:[{id:'entry'}],rowCount:1})
   .mockResolvedValueOnce({rows:[],rowCount:1});
  transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
  const audited=new CoupleJournalService({transaction} as unknown as DatabaseService);
  await expect(audited.remove('space','entry','user')).resolves.toEqual({deleted:true,id:'entry'});
  expect(clientQuery.mock.calls[3][0]).toContain('couple.journal_entry.deleted');
 });

});
