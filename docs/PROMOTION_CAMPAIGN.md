# OpenMagic Promotion Campaign

This document tracks responsible submissions of OpenMagic to relevant awesome lists and open-source directories.

## Submission policy

A directory is eligible only when all of the following are true:

1. OpenMagic is absent from the current default branch.
2. The repository is an actual curated resource list.
3. The list contains a developer, coding, CLI, editing, agent, or closely related category.
4. Contributions or pull requests are explicitly accepted.
5. The repository is active and not archived.
6. Self-promotion is not prohibited.
7. The change follows the list's format and contribution instructions.
8. Only one live submission is kept for each upstream repository.

The campaign does not use indiscriminate bulk pull requests. Targets are verified first, and submissions are kept minimal and repository-specific.

## Existing campaign audit

A live audit of the earlier campaign found:

- 105 pull requests
- 61 distinct upstream repositories
- 5 merged placements
- 90 open pull requests
- 10 closed without merge
- 23 repositories with duplicate submissions

Audit evidence:

- [Campaign audit](https://github.com/Kalmuraee/awesome-ai-devtools/tree/openmagic-promotion-audit/promotion-audit)
- [Complete PR ledger](https://github.com/Kalmuraee/awesome-ai-devtools/blob/openmagic-promotion-audit/promotion-audit/all-prs.csv)
- [Duplicate and cleanup queue](https://github.com/Kalmuraee/awesome-ai-devtools/blob/openmagic-promotion-audit/promotion-audit/cleanup-required.json)

## Merged placements

- `ai-for-developers/awesome-ai-coding-tools` — PR #259
- `PierrunoYT/awesome-ai-dev-tools` — PR #19
- `tyler-j-dao/awesome-ai-coding-tools` — PR #1
- `skyming/awesome-ai-agent` — PR #5
- `sajadh76/awesome-AI-tools` — PR #14

## Exact submission branches prepared

Each branch below is based on the current upstream head and was checked to ensure the diff contains only the intended OpenMagic entry.

| Target | Category | Verified change | Compare |
|---|---|---:|---|
| `filipecalegario/awesome-generative-ai` | AI development tools | 1 addition, 0 deletions | [Open compare](https://github.com/filipecalegario/awesome-generative-ai/compare/main...Kalmuraee:add-openmagic-v0450?expand=1) |
| `tatn/awesome-ai-coding-cli` | Available on GitHub | 2 files, 1 addition each | [Open compare](https://github.com/tatn/awesome-ai-coding-cli/compare/main...Kalmuraee:add-openmagic?expand=1) |
| `deepakdukare/-Awesome-AI-Powered-Developer-Tools` | Command-line | 1 addition, 0 deletions | [Open compare](https://github.com/deepakdukare/-Awesome-AI-Powered-Developer-Tools/compare/main...Kalmuraee:add-openmagic?expand=1) |
| `danielrosehill/Awesome-AI-Coding-Tools` | Editing | 1 addition, 0 deletions | [Open compare](https://github.com/danielrosehill/Awesome-AI-Coding-Tools/compare/main...Kalmuraee:add-openmagic?expand=1) |
| `mahseema/awesome-ai-tools` | Code | 2 additions, 0 deletions | [Open compare](https://github.com/mahseema/awesome-ai-tools/compare/main...Kalmuraee:add-openmagic-v0450?expand=1) |

The Mahseema fork's separate Notah.ai pull-request head was preserved when the OpenMagic branch was created.

## Distinct target discovery

The discovery pass produced:

- 525 distinct candidate repositories
- 464 newly qualified search candidates outside the earlier campaign
- 130 existing forks inspected

Discovery evidence:

- [Target discovery report](https://github.com/Kalmuraee/awesome-ai-devtools/tree/openmagic-target-discovery/promotion-targets)

## Verified 100-target ledger

A second-stage automated review was completed on August 28, 2026. It re-read the current upstream repositories and produced:

- **100 distinct target repositories** in the final ledger
- **159 repositories** in the broader verified pool
- **191 candidates rejected** during the strict pass
- OpenMagic absent from all 100 final targets at verification time
- Active, non-archived repositories only
- A detected contribution path and at least one potentially relevant category for every included repository

Evidence:

- [Final 100-target report](https://github.com/Kalmuraee/awesome-ai-devtools/tree/openmagic-final-100/promotion-final-100)
- [Machine-readable 100-target ledger](https://github.com/Kalmuraee/awesome-ai-devtools/blob/openmagic-final-100/promotion-final-100/targets.json)
- [Broader verified pool](https://github.com/Kalmuraee/awesome-ai-devtools/blob/openmagic-final-100/promotion-final-100/verified-pool.json)
- [Rejected candidates](https://github.com/Kalmuraee/awesome-ai-devtools/blob/openmagic-final-100/promotion-final-100/rejected.json)

The final ledger is a targeting and review queue, not authorization for indiscriminate submission. Category detection is automated, so every entry must receive a final human relevance check before a branch or pull request is created. Issue-only directories, narrow research lists, prompt collections, governance directories, and other weak-fit categories must be removed during that review even when a generic developer-related heading was detected.

## Access boundary

The connected GitHub App can create and validate branches in repositories owned by `Kalmuraee`. It cannot create a pull request in an external maintainer's repository unless that repository has installed the same GitHub App. Attempts against uninstalled upstream repositories return `403 Resource not accessible by integration`.

For such repositories, the compare links above are the final prepared submission pages. Opening a compare link in a user-authorized GitHub session creates the upstream pull request without changing the verified branch.

## Cleanup priorities

1. Close or supersede duplicate submissions.
2. Withdraw submissions where OpenMagic is already listed.
3. Withdraw submissions to inactive or mismatched repositories.
4. Keep one compliant submission for each qualified upstream repository.
5. Manually review the automated 100-target ledger before preparing more branches.
6. Prioritize high-fit, actively maintained lists over raw submission count.
