---
title: "CodeCup - Before Second Test Competition"
description: "CodeCup 2027 Training Updates"
date: 2026-09-18
tags: ["codecup", "codecup 2027", "ai", "claude code", "claude desktop", "opus", "opus 5", "fable", "fable 5"]
---

# CodeCup 2027 Before Second Test

After the [pnn7 training](/blog/2026-09-07-codecup-2027-pnn7), pnn8 through pnn11 were created.  These versions updated the network and other features.  Improvements to the competition scoring were achieved, and the computations were made faster.

After running a series of experiments, Fable 5 created pnn12 and pnn13.  The experiments improved the win-loss record and the total score in the competition.

A local competition was run, and the results were:
| Points | Player |
| ------ | ------ |
| 38497 | pnn12 |
| 38315 | pnn13 |
| 38218 | pnn10 |
| 37523 | pnn11 |
| 35873 | pnn9 |
| 35165 | pnn7 |
| 35159 | pnn8 |
| 33263 | pnn6 |
| 30601 | pnn5c |
| 29286 | pnn5 |

pnn12 was submitted for the second test competition on September 19.

## Potential Updates

From the competition forum, there is strong evidence that most of the starting locations favor the red player (the first player).  Contestants in the forum showed their research.

The thread in the forum suggested adding an extra random move for the red player at the beginning of the game to balance out the starting advantage.  The competitors' research showed that the red player would win 98% of the time with the original rules.  This advantage was reduced to 75% when adding a third move.  Others have reported over 90% in favor of the red player for the original rules.

Fable 5 was asked to do a similar analysis with the current program.  The results aligned with the posts in the forum.
