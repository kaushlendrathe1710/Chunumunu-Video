import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const videoCategories = pgTable("video_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  iconUrl: text("icon_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const videos = pgTable("videos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url").notNull(),
  videoUrl: text("video_url").notNull(),
  duration: integer("duration").notNull(),
  views: integer("views").default(0),
  likes: integer("likes").default(0),
  dislikes: integer("dislikes").default(0),
  userId: integer("user_id").notNull(),
  categoryId: integer("category_id").references(() => videoCategories.id),
  createdAt: timestamp("created_at").defaultNow(),
  isPublished: boolean("is_published").default(false),
  isShort: boolean("is_short").default(false),
  pinnedCommentIds: integer("pinned_comment_ids").array().default([]),
});

export const videoTranscodings = pgTable("video_transcodings", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id").notNull(),
  masterUrl: text("master_url").notNull(),
  hsl144pUrl: text("hsl144p_url"),
  hsl240pUrl: text("hsl240p_url"),
  hsl360pUrl: text("hsl360p_url"),
  hsl480pUrl: text("hsl480p_url"),
  hsl720pUrl: text("hsl720p_url"),
  createdAt: timestamp("created_at").defaultNow(),
});
