jest.mock('jose',()=>({
  SignJWT: class {
    setProtectedHeader(){return this;}
    setIssuer(){return this;}
    setAudience(){return this;}
    setSubject(){return this;}
    setIssuedAt(){return this;}
    setExpirationTime(){return this;}
    async sign(){return 'mock.signed.access.token';}
  },
  jwtVerify: jest.fn(),
}));

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import { DatabaseService } from '../database/database.service';
import { SessionTokenService } from './session-token.service';

describe('SessionTokenService',()=>{
  const query=jest.fn();
  const transaction=jest.fn();
  const db={query,transaction} as unknown as DatabaseService;
  const config={get:jest.fn().mockReturnValue('s'.repeat(64))} as unknown as ConfigService;
  const service=new SessionTokenService(db,config);
  const userId='11111111-1111-4111-8111-111111111111';
  const sessionId='22222222-2222-4222-8222-222222222222';
  const deviceId='33333333-3333-4333-8333-333333333333';
  const refreshToken='mrt_'+'A'.repeat(64);
  const expiresAt=new Date(Date.now()+24*60*60*1000);

  beforeEach(()=>{query.mockReset();transaction.mockReset();});

  it('fails fast when the session signing secret is missing or shorter than 32 bytes',()=>{
    const invalidConfig={get:jest.fn().mockReturnValue('short')} as unknown as ConfigService;
    expect(()=>new SessionTokenService(db,invalidConfig)).toThrow('MOMENTIA_SESSION_SECRET must contain at least 32 bytes.');
    const missingConfig={get:jest.fn().mockReturnValue(undefined)} as unknown as ConfigService;
    expect(()=>new SessionTokenService(db,missingConfig)).toThrow('MOMENTIA_SESSION_SECRET must contain at least 32 bytes.');
  });

  it('accepts a signing secret of at least 32 UTF-8 bytes',()=>{
    const validConfig={get:jest.fn().mockReturnValue('s'.repeat(32))} as unknown as ConfigService;
    expect(()=>new SessionTokenService(db,validConfig)).not.toThrow();
  });

  it('creates an access and refresh token only for an active account',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{id:userId}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:sessionId,expires_at:expiresAt}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    const result=await service.create(userId,undefined,{userAgent:'test-agent'});
    expect(result).toMatchObject({tokenType:'Bearer',expiresIn:900,sessionId});
    expect(result.accessToken).toMatch(/^mta_/);
    expect(result.refreshToken).toMatch(/^mrt_[A-Za-z0-9_-]{60,80}$/);
    expect(clientQuery.mock.calls[0][0]).toContain("status='active'");
    expect(clientQuery.mock.calls[3][0]).toContain("jsonb_build_object('deviceId',$3::text)");
    expect(clientQuery.mock.calls[3][1][2]).toBeNull();
  });

  it('rejects session creation for inactive accounts',async()=>{
    const clientQuery=jest.fn().mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.create(userId)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  it('requires a non-revoked device when a device id is supplied',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{id:userId}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.create(userId,deviceId)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clientQuery.mock.calls[1][0]).toContain('revoked_at IS NULL');
  });

  it('rejects malformed refresh tokens without database access',async()=>{
    await expect(service.refresh('invalid')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rotates a valid refresh token and persists one-time consumption',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{token_hash:'old',session_id:sessionId,family_id:'family-1',expires_at:expiresAt,consumed_at:null}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:sessionId,user_id:userId,device_id:null,expires_at:expiresAt,status:'active',device_id_found:null,device_revoked_at:null}],rowCount:1})
      .mockResolvedValueOnce({rows:[{token_hash:'old'}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    const result=await service.refresh(refreshToken);
    expect(result).toMatchObject({tokenType:'Bearer',expiresIn:900,sessionId});
    expect(result.accessToken).toMatch(/^mta_/);
    expect(result.refreshToken).not.toBe(refreshToken);
    expect(clientQuery.mock.calls[2][0]).toContain('consumed_at=now()');
    expect(clientQuery.mock.calls[3][0]).toContain('auth_session_refresh_tokens');
    expect(clientQuery.mock.calls[4][0]).toContain('refresh_token_hash=$1');
  });

  it('revokes the entire refresh family when a consumed token is reused',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{token_hash:'old',session_id:sessionId,family_id:'family-1',expires_at:expiresAt,consumed_at:new Date()}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clientQuery.mock.calls[1][0]).toContain('WHERE family_id=$1');
    expect(clientQuery.mock.calls[2][0]).toContain('refresh_reuse_detected');
  });

  it('rejects expired refresh tokens before session rotation',async()=>{
    const clientQuery=jest.fn().mockResolvedValueOnce({
      rows:[{token_hash:'old',session_id:sessionId,family_id:'family-1',expires_at:new Date(Date.now()-1000),consumed_at:null}],
      rowCount:1,
    });
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  it('validates the signed access token and confirms the live session',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{id:userId}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:sessionId,expires_at:expiresAt}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    const created=await service.create(userId);
    (jwtVerify as unknown as jest.Mock).mockResolvedValueOnce({payload:{sub:userId,sid:sessionId,typ:'access'}});
    query.mockResolvedValueOnce({rows:[{user_id:userId}],rowCount:1});
    await expect(service.verifyAccessToken(created.accessToken)).resolves.toEqual({userId,sessionId});
    expect(query.mock.calls[0][0]).toContain("u.status='active'");
  });

  it('rejects revoked access sessions and invalid tokens',async()=>{
    await expect(service.verifyAccessToken('bad-token')).rejects.toBeInstanceOf(UnauthorizedException);
    (jwtVerify as unknown as jest.Mock).mockRejectedValueOnce(new Error('invalid jwt'));
    query.mockResolvedValueOnce({rows:[],rowCount:0});
    await expect(service.verifyAccessToken('mta_invalid')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cleans expired refresh tokens and sessions in bounded batches',async()=>{
    await expect(service.cleanupExpiredSessions(0)).rejects.toThrow();
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{token_hash:'x'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:sessionId}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.cleanupExpiredSessions(100)).resolves.toEqual({deletedRefreshTokens:1,deletedSessions:1});
    expect(clientQuery.mock.calls[0][0]).toContain('SKIP LOCKED');
    expect(clientQuery.mock.calls[1][0]).toContain('auth_sessions');
  });
});
