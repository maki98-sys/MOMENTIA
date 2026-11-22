import { DatabaseService } from './database.service';

describe('DatabaseService transactions',()=>{
  it('rolls back and preserves the original operation error',async()=>{
    const original=new Error('operation failed');
    const query=jest.fn().mockResolvedValue({rows:[],rowCount:0});
    const release=jest.fn();
    const client={query,release};
    const pool={connect:jest.fn().mockResolvedValue(client),query:jest.fn(),end:jest.fn()};
    const db=new DatabaseService(pool as any);
    await expect(db.transaction(async()=>{throw original;})).rejects.toBe(original);
    expect(query.mock.calls.map(call=>call[0])).toEqual(['BEGIN','ROLLBACK']);
    expect(release).toHaveBeenCalledWith();
  });

  it('discards a client when rollback itself fails',async()=>{
    const original=new Error('operation failed');
    const query=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockRejectedValueOnce(new Error('connection lost'));
    const release=jest.fn();
    const client={query,release};
    const pool={connect:jest.fn().mockResolvedValue(client),query:jest.fn(),end:jest.fn()};
    const db=new DatabaseService(pool as any);
    await expect(db.transaction(async()=>{throw original;})).rejects.toBe(original);
    expect(release).toHaveBeenCalledWith(expect.any(Error));
  });
});
