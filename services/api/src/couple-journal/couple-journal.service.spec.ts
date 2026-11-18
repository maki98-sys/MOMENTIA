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
});
