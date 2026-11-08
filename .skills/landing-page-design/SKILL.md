---
name: landing-page-design
description: Strict design and conversion copywriting rules from elayadesign/ai-design-skills to eliminate AI slop, enforce high-craft visual systems, and create beautiful, credible SaaS web experiences.
---

# AI Design Skills — Landing Page & Dashboard Design System
*Based on elayadesign/ai-design-skills*

## Part A: Strategy & Structure
1. **Single Goal Focus**: Every section must serve one core purpose. No rambling or redundant boilerplate.
2. **Realism**:
   - Zero "AI slop" or tech clichés: Avoid words like *Seamless, Unleash, Next-Gen, Game Changer, Delve, In the world of*.
   - Organic, credible numbers instead of lazy fake figures (`$1,420.00`, `99.9%`).
   - Authentic POD / e-commerce merchant workflows: Printify store API connection, webhook tunnel, daily morning digest, trending niche inspiration.
3. **Structured Flow**:
   - Top Header & Status &rarr; Primary KPIs &rarr; Store Connection & Realtime Feed &rarr; Creative Inspiration (Pinterest POD Trends) &rarr; Actionable Merchant Playbook &rarr; Inline Support Contact.

## Part B: Non-Negotiable Visual System
1. **B1. Typography**:
   - **Allowed Fonts**: `Geist`, `Manrope`, `Poppins`, system-ui.
   - **Banned**: `Inter`, `Arial`, `Roboto`, `Open Sans`, `Helvetica` when used lazily.
   - **Limit**: Only ONE primary typeface family across the application.
   - **Weights**: Maximum font weight capped at bold (700); no 900/Black weights.
   - **No Italics**: Clean, upright typography.
2. **B2. Spacing**:
   - Strict spacing scale: 8px (0.5rem), 12px (0.75rem), 16px (1rem), 24px (1.5rem), 32px (2rem), 48px (3rem).
   - Component padding: Buttons adhere to 8–10px vertical and 12–16px horizontal padding.
3. **B3. Corner Radii & Hierarchy**:
   - Standard scale: `rounded-lg` (8px), `rounded-xl` (12px), `rounded-2xl` (16px).
   - Nested radius formula: $\text{Inner Radius} = \text{Outer Radius} - \text{Gap}$.
4. **B4. Borders & Surfaces**:
   - No 1-sided borders; borders go all the way around or not at all (`1px solid rgba(226, 232, 240, 0.8)` in light, `rgba(255, 255, 255, 0.08)` in dark).
   - **Flat, subtle surfaces**: Clean background tones without muddy dual-tone claymorphism. Clean elevation with soft diffuse shadows: `box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 10px 25px -5px rgba(0,0,0,0.04)`.
5. **B5. Color Hierarchy**:
   - Primary: Deep Indigo / Violet (`#4F46E5` or `#6366F1`)
   - Neutral Base: Ultra-clean slate / zinc (`#F8FAFC` base background, `#FFFFFF` crisp card surfaces, `#0F172A` deep slate text).
   - Accents: Emerald (`#10B981`) for live status/success, Rose (`#F43F5E`) for alerts, Amber (`#F59E0B`) for pending.
6. **B6. Icons**:
   - Strict sizing constraint: Max 20px (headers max 24px), crisp stroke width (1.75px–2px).
   - Clean geometric inline SVGs. No broken overflowing SVG graphics.
7. **B7. Motion**:
   - Smooth deceleration physics (`cubic-bezier(0.16, 1, 0.3, 1)`).
   - No unthrottled layout jank.
