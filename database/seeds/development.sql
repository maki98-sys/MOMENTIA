-- Synthetic local/demo fixtures only. Never apply to production.
BEGIN;

INSERT INTO users(id,email_normalized,status) VALUES
 ('10000000-0000-4000-8000-000000000001','demo-owner@momentia.invalid','pending'),
 ('10000000-0000-4000-8000-000000000002','demo-member@momentia.invalid','pending'),
 ('10000000-0000-4000-8000-000000000003','demo-guest@momentia.invalid','pending')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles(user_id,display_name,visibility) VALUES
 ('10000000-0000-4000-8000-000000000001','Demo Owner','private'),
 ('10000000-0000-4000-8000-000000000002','Demo Member','private'),
 ('10000000-0000-4000-8000-000000000003','Demo Guest','private')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO spaces(id,type,owner_id,name,visibility,status) VALUES
 ('20000000-0000-4000-8000-000000000001','EVENT','10000000-0000-4000-8000-000000000001','Demo Event','private','active'),
 ('20000000-0000-4000-8000-000000000002','COUPLE','10000000-0000-4000-8000-000000000001','Demo Couple','private','active'),
 ('20000000-0000-4000-8000-000000000003','CIRCLE','10000000-0000-4000-8000-000000000002','Demo Circle','private','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_details(space_id,timezone,moderation_mode,download_policy)
VALUES ('20000000-0000-4000-8000-000000000001','America/Guayaquil','host','members')
ON CONFLICT (space_id) DO NOTHING;
INSERT INTO couple_details(space_id) VALUES ('20000000-0000-4000-8000-000000000002')
ON CONFLICT (space_id) DO NOTHING;
INSERT INTO circle_details(space_id,description,join_policy)
VALUES ('20000000-0000-4000-8000-000000000003','Synthetic development circle','invite')
ON CONFLICT (space_id) DO NOTHING;

INSERT INTO space_memberships(space_id,user_id,role,state,joined_at) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner','active',now()),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','member','active',now()),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','guest','active',now()),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','owner','active',now()),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','member','active',now()),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','owner','active',now()),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','member','active',now())
ON CONFLICT (space_id,user_id) DO NOTHING;

INSERT INTO event_albums(id,space_id,created_by,title)
VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Demo Event Album')
ON CONFLICT (id) DO NOTHING;

COMMIT;
