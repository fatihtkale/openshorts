CREATE TABLE `schedule_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`time_zone` text NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`mode` text NOT NULL,
	`jitter_min` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `posts` ADD `batch_id` text REFERENCES schedule_batches(id);--> statement-breakpoint
CREATE INDEX `posts_scheduled_idx` ON `posts` (`scheduled_at`);