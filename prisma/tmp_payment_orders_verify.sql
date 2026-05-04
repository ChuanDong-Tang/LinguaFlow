SELECT column_name FROM information_schema.columns WHERE table_name='payment_orders' ORDER BY ordinal_position;
SELECT indexname FROM pg_indexes WHERE tablename='payment_orders' ORDER BY indexname;
