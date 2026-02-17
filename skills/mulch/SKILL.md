---
name: mulch
description: Record and retrieve structured project learnings using `mulch` CLI. Use when working on code and wanting to capture patterns, failures, decisions, conventions, references, or guides for future sessions.
---

# Mulch Usage

Mulch captures project learnings as structured "records" organized by **domain**. Each domain represents a category of knowledge:

| Domain | Description |
|--------|-------------|
| `purpose` | Why the project exists |
| `identity` | Brand, naming, tone |
| `public-interface` | APIs, CLI, UI surfaces |
| `internal-structure` | Code organization |
| `dependencies` | External libraries |
| `data` | Database, schemas, models |
| `configuration` | Env vars, settings |
| `observability` | Logging, metrics, tracing |
| `glossary` | Domain-specific terminology |

---

# When to Run Commands

## 1. At Session Start

Load all project expertise into your context:

```bash
mulch prime                    # load all project learnings
mulch prime --files src/foo.ts # load only records relevant to specific files
```

This gives you awareness of existing patterns, decisions, and conventions before you start working.

## 2. While Working

Record insights as you discover them:

```bash
# Create a new domain if needed
mulch add purpose

# Record different types of learnings
mulch record <domain> --type pattern --name "Auth Pattern" --description "Use middleware for auth checks before route handlers"
mulch record <domain> --type failure --name "Missing Validation" --description "Form field not validated on client" --resolution "Add Zod schema validation"
mulch record <domain> --type decision --title "Chose PostgreSQL" --rationale "Needed relational queries and ACID compliance"
mulch record <domain> --type convention --content "API routes go in src/routes/"
mulch record <domain> --type reference --name "Error Handling" --description "See docs/error patterns"
mulch record <domain> --type guide --name "Setup Guide" --description "Run npm install then npm run dev"

# Add evidence, files, tags
mulch record <domain> --type pattern --name "..." --description "..." --evidence-commit abc123
mulch record <domain> --type pattern --name "..." --description "..." --evidence-bead fix-42   # link to bd issue
mulch record <domain> --type pattern --name "..." --description "..." --files "src/auth.ts,src/middleware.ts"
mulch record <domain> --type pattern --name "..." --description "..." --tags "security,auth"

# Link related records
mulch record <domain> --type pattern --name "..." --description "..." --relates-to mx-abc123
mulch record <domain> --type pattern --name "..." --description "..." --supersedes mx-old123

# Batch record from JSON file
mulch record <domain> --batch records.json
mulch record <domain> --batch records.json --dry-run  # preview first
```

## 3. Before Finishing Your Task

After all file editing is done (but before committing), run `mulch learn` to see what changed and get recording suggestions:

```bash
mulch learn
mulch learn --since HEAD~3  # diff against specific commit
```

This shows which files were modified and can suggest what to record based on your changes.

Then record any learnings and sync to git:

```bash
mulch record <domain> ...  # record learnings from this session
mulch sync                  # validates, stages, and commits .mulch/ changes
```

**Note:** `mulch sync` runs `mulch validate` automatically before committing, so you don't need a separate validate step.

---

# Querying & Searching

**Tip:** `--json` is a global flag that works with all commands below.

```bash
# Check domain status
mulch status --json
mulch status --json | jq '.'

# Query records in a domain
mulch query <domain> --json
mulch query <domain> --type failure --json  # filter by type

# Search across all domains
mulch search "auth" --json
mulch search "auth" --type pattern --json      # filter by type
mulch search "auth" --tag security --json      # filter by tag
mulch search "auth" --domain <domain> --json   # limit to domain

# Show recent additions
mulch ready --json

# Show changes since git ref
mulch diff --json
mulch diff --since v1.0.0 --json
```

## Other Useful Commands

```bash
# Edit a record
mulch edit <domain> mx-abc123 --description "Updated description"

# Delete a record
mulch delete <domain> mx-abc123

# Compact similar records
mulch compact <domain> --analyze
mulch compact <domain> --apply --type pattern --name "Auth Patterns" --description "Combined from 5 records"

# Generate onboarding snippet for AGENTS.md
mulch onboard
mulch onboard --check  # verify it's installed

# Health check
mulch doctor  # check for issues with --fix option

# Check for updates
mulch update
```

## JSON Output

All commands support `--json` for scripting:
```bash
mulch status --json | jq '.'
mulch query <domain> --json | jq '.[] | select(.type == "failure")'
mulch search "auth" --json | jq '.[] | .name'
```
