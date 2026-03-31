# Model Routing for Triangulation

Select models based on task type. Each stage uses a different provider to maximize reasoning diversity.

| Task Type | Generate | Critique | Resolve |
|-----------|----------|----------|---------|
| code | claude-sonnet-4-6 | gpt-4o | gemini-2.5-pro |
| research | claude-sonnet-4-6 | gemini-2.5-pro | gpt-4o |
| writing | claude-sonnet-4-6 | gpt-4o | gemini-2.5-pro |
| architecture | claude-opus-4-6 | gemini-2.5-pro | gpt-4o |
| math | gemini-2.5-pro | claude-sonnet-4-6 | gpt-4o |
| factcheck | claude-sonnet-4-6 | gpt-4o | gemini-2.5-pro |
| default | claude-sonnet-4-6 | gpt-4o | gemini-2.5-pro |

## Classification Guide

- **code**: implementation, debugging, refactoring, code review, scripts
- **research**: investigation, comparison, evidence gathering, literature review
- **writing**: drafting, editing, creative content, documentation, communication
- **architecture**: system design, technical decisions, infrastructure, database schema
- **math**: calculations, formal proofs, statistical analysis, optimization
- **factcheck**: verification, accuracy review, claim validation
