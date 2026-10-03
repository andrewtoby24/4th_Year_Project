USE qr_attendance;

ALTER TABLE attendance
  ADD COLUMN latitude DECIMAL(10,7) NULL AFTER status,
  ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude,
  ADD COLUMN accuracy DECIMAL(8,2) NULL AFTER longitude,
  ADD COLUMN distance_from_classroom DECIMAL(10,2) NULL AFTER accuracy;
