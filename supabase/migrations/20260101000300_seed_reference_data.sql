-- =============================================================================
-- AI Video Studio — reference data seed
-- =============================================================================
-- Idempotent. Safe to re-run: rows are matched on their natural key (slug).
--
-- video_experiences is operational data the /create flow reads at runtime.
-- portfolio_items here is PLACEHOLDER MARKETING CONTENT for the MVP. media_url
-- and thumbnail_url are intentionally NULL — the portfolio grid renders a
-- designed typographic placeholder until real showcase films exist. Replace
-- these rows before any commercial launch.
-- =============================================================================

insert into public.video_experiences (slug, name, description, category, active, sort_order)
values
  ('luxury-lifestyle', 'Luxury Lifestyle',
   'Yachts, penthouses and private terraces. Slow, considered camera moves and a sense of arrival.',
   'LUXURY_LIFESTYLE', true, 10),
  ('fashion', 'Fashion',
   'Editorial movement and styling. Built around wardrobe, silhouette and a strong colour story.',
   'FASHION', true, 20),
  ('cinematic', 'Cinematic',
   'Narrative-led and film-graded. Anamorphic framing, deliberate pacing, a scene rather than a clip.',
   'CINEMATIC', true, 30),
  ('celebration', 'Celebration',
   'Birthdays, engagements and milestones, treated with the production value of a title sequence.',
   'CELEBRATION', true, 40),
  ('travel', 'Travel',
   'Destination storytelling. Landscape, light and motion built around a single journey.',
   'TRAVEL', true, 50),
  ('executive', 'Executive',
   'Authority and composure for founders and leaders. Considered, restrained, boardroom-ready.',
   'EXECUTIVE', true, 60),
  ('social-media', 'Social Media',
   'Vertical-first and built to hold attention in the opening second, without losing craft.',
   'SOCIAL_MEDIA', true, 70),
  ('custom-concept', 'Custom Concept',
   'None of the above. Describe the film you have in mind and we will build the treatment around it.',
   'BESPOKE', true, 80)
on conflict (slug) do update
  set name        = excluded.name,
      description = excluded.description,
      category    = excluded.category,
      active      = excluded.active,
      sort_order  = excluded.sort_order;

insert into public.portfolio_items
  (slug, title, description, category, experience_id, media_url, thumbnail_url, featured, active, sort_order)
values
  ('monaco-summer', 'Monaco, Late Summer',
   'A walk through a berthed yacht at golden hour. Warm highlights, deep shadow, minimal movement.',
   'LUXURY_LIFESTYLE', null, null, null, true, true, 10),
  ('atelier-noir', 'Atelier Noir',
   'Studio editorial in high contrast monochrome, cut to a single sustained rhythm.',
   'FASHION', null, null, null, true, true, 20),
  ('the-long-drive', 'The Long Drive',
   'Anamorphic night drive. Practical light, reflective surfaces, a film-grade finish.',
   'CINEMATIC', null, null, null, true, true, 30),
  ('first-light-reel', 'First Light',
   'Vertical social cut designed to land its subject inside the opening second.',
   'SOCIAL_MEDIA', null, null, null, false, true, 40),
  ('thirty-under-lights', 'Thirty, Under Lights',
   'A milestone birthday treated as a title sequence rather than an event video.',
   'CELEBRATION', null, null, null, false, true, 50),
  ('kyoto-in-rain', 'Kyoto In Rain',
   'Destination piece built on reflection, texture and a restrained colour palette.',
   'TRAVEL', null, null, null, false, true, 60),
  ('corner-office', 'Corner Office',
   'Founder portrait in motion. Composed framing, no gimmicks, built for a keynote open.',
   'EXECUTIVE', null, null, null, false, true, 70),
  ('archive-no-4', 'Archive No. 4',
   'A commissioned concept with no template behind it, developed from the brief up.',
   'BESPOKE', null, null, null, false, true, 80)
on conflict (slug) do update
  set title         = excluded.title,
      description   = excluded.description,
      category      = excluded.category,
      featured      = excluded.featured,
      active        = excluded.active,
      sort_order    = excluded.sort_order;

-- Link each placeholder showcase to the experience a visitor would pick to get
-- the same result. This is what makes "Create Your Version" work.
update public.portfolio_items pi
set experience_id = ve.id
from public.video_experiences ve
where ve.category = pi.category
  and pi.experience_id is null;
