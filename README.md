# Lead Radar

Lead Radar is an AI-powered lead generation pipeline built for modern software and service agencies. It actively scans social media platforms (currently Threads) for potential buyers—people who are looking to hire developers, designers, or consultants—and qualifies them against your actual business offerings.

## Features

- **Automated Social Listening:** Connects to the official Threads API (and Apify as a fallback) to find posts matching your configured keywords.
- **Business Profile Extraction:** Paste your agency's website URL. The AI scans your site, extracts the exact services you sell, and uses this "Confirmed Profile" as ground truth for qualifying leads.
- **AI Classification Pipeline:** Uses Google's Gemini models to analyze each post. It determines if the author is a buyer or seller, rates their intent, translates their language, and scores the fit against your business offerings.
- **Auto Public Reply (Queue):** Automatically schedules public replies to highly qualified leads. Sent via a delayed message queue (10-15 minutes) to respect platform anti-spam rules. (Requires Meta App Review for `threads_content_publish`).
- **Multi-tenant Architecture:** Designed to support multiple client workspaces out of the box (Row-Level Security, separate API keys, and settings per workspace).
- **Export & Webhooks:** Export your qualified leads to Excel (`.xlsx`) or receive them via automated background crons.

## Tech Stack

- **Framework:** Next.js (App Router, TypeScript)
- **Styling:** Tailwind CSS
- **Database:** PostgreSQL on Supabase (with pgvector for future embeddings)
- **AI:** Google Gemini (`gemini-1.5-flash`) via AI SDK
- **Testing:** Vitest

## Setup

1. **Environment Variables:** Copy `.env.example` to `.env` and fill in your keys (Supabase, Gemini, Meta OAuth, Cron Secret).
2. **Database Migration:** Run `npm run migrate` to create all tables (via PGlite/Supabase).
3. **Seed:** Run `npm run seed` to create the initial owner workspace.
4. **Dev Server:** Run `npm run dev` to start locally.

## Important Note on Meta API

For the **Auto Public Reply** feature to work in production, your Meta App must be approved for the `threads_content_publish` scope. By default, test mode allows fetching your own test posts, but publishing automated replies requires a formal App Review by Meta to justify the use case.