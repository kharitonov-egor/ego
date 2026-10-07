-- A browser signs in like the apps but comes back to a web page instead of an ego:// link, and
-- its token lapses after a stretch without use. The apps leave all four columns null.
ALTER TABLE sign_in_requests ADD COLUMN return_url TEXT;
ALTER TABLE sign_in_requests ADD COLUMN idle_days INTEGER;
ALTER TABLE devices ADD COLUMN web_origin TEXT;
ALTER TABLE devices ADD COLUMN idle_days INTEGER;
