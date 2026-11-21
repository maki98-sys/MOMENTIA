import { BillingService } from './billing.service';
import { DatabaseService } from '../database/database.service';

describe('BillingService', () => {
  let service: BillingService;
  let db: jest.Mocked<Pick<DatabaseService, 'query'>>;

  beforeEach(() => {
    db = { query: jest.fn() } as unknown as jest.Mocked<Pick<DatabaseService, 'query'>>;
    service = new BillingService(db as unknown as DatabaseService);
  });

  it('lists public plans in database order', async () => {
    const plans = [{ code: 'free' }, { code: 'pro' }];
    db.query.mockResolvedValue({ rows: plans, rowCount: 2 } as never);
    await expect(service.listPlans()).resolves.toEqual(plans);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE is_public=true'));
  });

  it('returns null when no entitlement plan matches', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await expect(service.getEntitlements('user-1')).resolves.toBeNull();
  });

  it('calculates remaining quota and usage percentage', async () => {
    db.query.mockResolvedValue({
      rows: [{
        storage_quota_bytes: '1000',
        used_bytes: '250',
        asset_count: 3,
        pending_bytes: '50',
        ready_bytes: '200',
        features: { albums: true },
      }],
      rowCount: 1,
    } as never);
    await expect(service.getEntitlements('user-1')).resolves.toMatchObject({
      storage_quota_bytes: '1000',
      used_bytes: '250',
      remaining_bytes: '750',
      asset_count: 3,
      pending_bytes: '50',
      ready_bytes: '200',
      storage_usage_percent: 25,
      features: { albums: true },
    });
  });

  it('does not return a negative remaining quota when usage exceeds quota', async () => {
    db.query.mockResolvedValue({
      rows: [{
        storage_quota_bytes: '100',
        used_bytes: '150',
        asset_count: '4',
        pending_bytes: '0',
        ready_bytes: '150',
        features: null,
      }],
      rowCount: 1,
    } as never);
    await expect(service.getEntitlements('user-1')).resolves.toMatchObject({
      remaining_bytes: '0',
      storage_usage_percent: 100,
      features: {},
    });
  });

  it('handles a zero-byte quota without division by zero', async () => {
    db.query.mockResolvedValue({
      rows: [{
        storage_quota_bytes: '0',
        used_bytes: '0',
        asset_count: 0,
        pending_bytes: '0',
        ready_bytes: '0',
      }],
      rowCount: 1,
    } as never);
    await expect(service.getEntitlements('user-1')).resolves.toMatchObject({
      remaining_bytes: '0',
      storage_usage_percent: 0,
    });
  });

  it('lists only the current user subscriptions', async () => {
    const subscriptions = [{ id: 'sub-1' }];
    db.query.mockResolvedValue({ rows: subscriptions, rowCount: 1 } as never);
    await expect(service.listMySubscriptions('user-1')).resolves.toEqual(subscriptions);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE us.user_id=$1'), ['user-1']);
  });
});
