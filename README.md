PostFlow

Production-grade multi-tenant social media scheduling SaaS backend (Buffer-style architecture).

PostFlow is a modular backend system that supports OAuth integrations, encrypted token storage, recurring scheduling, queue-based publishing, and subscription plan enforcement.

⸻

🚀 Features
	•	Pluggable OAuth provider framework (PKCE + state validation)
	•	AES-256-GCM encrypted token vault
	•	BullMQ-based background publishing engine
	•	Recurring weekly scheduling (per-account queue slots)
	•	Rate limit & retry handling (429 + 5xx)
	•	Subscription & plan enforcement (Free / Pro / Team)
	•	Grace period support
	•	Multi-tenant organization architecture

⸻

🛠 Tech Stack

Node.js · Express · MongoDB · Redis · BullMQ · Stripe-ready billing
