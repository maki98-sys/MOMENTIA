import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EventRsvpsService } from './event-rsvps.service';

describe('EventRsvpsService',()=>{
  const query=jest.fn(),transaction=jest.fn();
  const service=new EventRsvpsService({query,transaction} as unknown as DatabaseService);
  beforeEach(()=>{query.mockReset();transaction.mockReset();});

  it('keeps RSVP summary access stable and returns active attendees to moderators',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{role:'admin'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{going:2,interested:1,declined:0,additional_guests:1}],rowCount:1})
      .mockResolvedValueOnce({rows:[{user_id:'u2',display_name:'Member',response:'going'}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.summary('u1','s1')).resolves.toMatchObject({
      going:2,interested:1,attendees:[{user_id:'u2',display_name:'Member',response:'going'}],
    });
    expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock_shared');
    expect(clientQuery.mock.calls[2][0]).toContain("u.status='active'");
    expect(clientQuery.mock.calls[3][0]).toContain("u.status='active'");
  });

  it('does not return RSVP counts to a user without active membership',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.summary('u1','s1')).rejects.toBeInstanceOf(NotFoundException);
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });
});
