CREATE TABLE `post_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`age_hours` real NOT NULL,
	`views` integer NOT NULL,
	`likes` integer,
	`comments` integer,
	`shares` integer,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_stats_post_idx` ON `post_stats` (`post_id`);