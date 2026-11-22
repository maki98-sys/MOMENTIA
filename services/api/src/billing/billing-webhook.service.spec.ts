import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BillingWebhookService } from './billing-webhook.service';

describe('BillingWebhookService',()=>{
  const query=jest.fn();
  const transaction=jest.fn();
  const service=new BillingWebhookService({query,transaction} as unknown as DatabaseService);
  const userId='11111111-1111-4111-8111-111111111111';
  const eventId='22222222-2222-4222-8222-222222222222';
  const validPayload={
    userId,planCode:'pro',subscriptionId:'sub_123',
    status:'active',occurredAt:'2026-11-22T00:00:00.000Z',
    periodStart:'2026-11-01T00:00:00.000Z',
    periodEnd:'2026-12-01T00:00:00.000Z',
  };

  beforeEach(()=>{query.mockReset();transaction.mockReset();});

  it('rejects invalid provider metadata before writing an event',async()=>{
    await expect(service.ingestVerifiedEvent('Stripe','evt_1','subscription.activated',validPayload))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.ingestVerifiedEvent('stripe','', 'subscription.activated',validPayload))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('stores a verified provider event once and reports duplicates',async()=>{
    query.mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:eventId,processing_status:'processed'}],rowCount:1});
    await expect(service.ingestVerifiedEvent('stripe','evt_123','subscription.activated',validPayload))
      .resolves.toMatchObject({accepted:true,duplicate:true,event:{id:eventId}});
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT(provider,provider_event_id) DO NOTHING');
    expect(query.mock.calls[1][0]).toContain('SELECT id,processing_status');
  });

  it('claims webhook work with SKIP LOCKED and clamps batch size',async()=>{
    const clientQuery=jest.fn().mockResolvedValueOnce({rows:[{id:eventId}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.claimBatch(1000)).resolves.toEqual([{id:eventId}]);
    expect(clientQuery.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(clientQuery.mock.calls[0][1]).toEqual([100]);
  });

  it('ignores unsupported provider event types without applying subscription changes',async()=>{
    const event={id:eventId,provider:'stripe',provider_event_id:'evt_1',event_type:'customer.updated',payload:{},attempts:1};
    const claimQuery=jest.fn().mockResolvedValueOnce({rows:[event],rowCount:1});
    const applyQuery=jest.fn().mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:claimQuery}))
      .mockImplementationOnce(async(work:any)=>work({query:applyQuery}));
    query.mockResolvedValueOnce({rows:[{processing_status:'ignored'}],rowCount:1});
    await expect(service.processBatch()).resolves.toEqual({claimed:1,processed:0,ignored:1,failed:0});
    expect(applyQuery.mock.calls[0][0]).toContain("processing_status='ignored'");
  });

  it('applies a valid activation and records provider event ordering',async()=>{
    const event={id:eventId,provider:'stripe',provider_event_id:'evt_1',event_type:'subscription.activated',payload:validPayload,attempts:1};
    const claimQuery=jest.fn().mockResolvedValueOnce({rows:[event],rowCount:1});
    const applyQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{id:'plan-id'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:userId}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:claimQuery}))
      .mockImplementationOnce(async(work:any)=>work({query:applyQuery}));
    query.mockResolvedValueOnce({rows:[{processing_status:'processed'}],rowCount:1});
    await expect(service.processBatch()).resolves.toEqual({claimed:1,processed:1,ignored:0,failed:0});
    expect(applyQuery.mock.calls[4][0]).toContain('INSERT INTO user_subscriptions');
    expect(applyQuery.mock.calls[4][0]).toContain('last_provider_event_at');
    expect(applyQuery.mock.calls[5][0]).toContain("processing_status='processed'");
  });

  it('ignores an older provider event instead of overwriting newer subscription state',async()=>{
    const event={id:eventId,provider:'stripe',provider_event_id:'evt_old',event_type:'subscription.updated',
      payload:{...validPayload,occurredAt:'2026-10-01T00:00:00.000Z'},attempts:1};
    const claimQuery=jest.fn().mockResolvedValueOnce({rows:[event],rowCount:1});
    const applyQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{id:'plan-id'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:userId}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:'subscription-id',user_id:userId,last_provider_event_at:'2026-11-01T00:00:00.000Z'}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:claimQuery}))
      .mockImplementationOnce(async(work:any)=>work({query:applyQuery}));
    query.mockResolvedValueOnce({rows:[{processing_status:'ignored'}],rowCount:1});
    await expect(service.processBatch()).resolves.toEqual({claimed:1,processed:0,ignored:1,failed:0});
    expect(applyQuery.mock.calls[3][0]).toContain("'STALE_PROVIDER_EVENT'");
    expect(applyQuery).toHaveBeenCalledTimes(4);
  });

  it('marks malformed verified payloads failed for retry',async()=>{
    const event={id:eventId,provider:'stripe',provider_event_id:'evt_bad',event_type:'subscription.activated',payload:{userId:'invalid'},attempts:1};
    const claimQuery=jest.fn().mockResolvedValueOnce({rows:[event],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:claimQuery}))
      .mockImplementationOnce(async(work:any)=>work({query:jest.fn()}));
    query.mockResolvedValueOnce({rows:[],rowCount:1});
    await expect(service.processBatch()).resolves.toEqual({claimed:1,processed:0,ignored:0,failed:1});
    expect(query.mock.calls[0][0]).toContain("processing_status=CASE WHEN attempts>=10 THEN 'dead_letter' ELSE 'failed' END");
  });

  it('validates stale lease recovery bounds and recovers expired processing leases',async()=>{
    await expect(service.recoverStale(10)).rejects.toBeInstanceOf(BadRequestException);
    query.mockResolvedValueOnce({rows:[{id:eventId}],rowCount:1});
    await expect(service.recoverStale(300)).resolves.toEqual({recovered:1});
    expect(query.mock.calls[0][0]).toContain("'PROCESSING_LEASE_EXPIRED'");
  });

  it('retries only valid dead-letter event identifiers',async()=>{
    await expect(service.retryDeadLetter('not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
    query.mockResolvedValueOnce({rows:[{id:eventId,processing_status:'received'}],rowCount:1});
    await expect(service.retryDeadLetter(eventId)).resolves.toMatchObject({retried:true,event:{id:eventId}});
    expect(query.mock.calls[0][0]).toContain("processing_status='dead_letter'");
  });
});
