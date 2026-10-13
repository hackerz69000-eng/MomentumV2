-- Allow reading uploads up to 100 MiB in the private study-files bucket.
-- This updates the existing bucket; it does not create or expose a public bucket.
UPDATE storage.buckets
SET file_size_limit = 104857600
WHERE id = 'study-files';
