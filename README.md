# Spell

A daily spelling practice for students in grades 3 to 6, built for [Compass](https://github.com/sigmaschools) with its public app kit. It is a plain web page: no server, no accounts, no storage of its own.

## How it works

- **Hear it, then spell it.** Each word is spoken alone, in a sentence, and alone again, and the student types it. The sentence is shown with a blank, so words that sound alike are told apart.
- **Attempt first, then a correction that has to be acted on.** A miss shows the word with its tricky letters marked; the student types it while looking, and then again from memory a few words later. Only the first attempt counts.
- **New words are taught before they are tested.** A new word is shown to copy, then tested from memory later in the same set, after other words.
- **Spaced review.** A word comes back the next day, then after 3, 7, 21 and 60 days. It counts as learned after it is spelled right on three separate days after the day it was taught; a miss starts it over.
- **Pattern groups, kept apart when they look alike.** 152 words in 19 groups (ai and ay, -tion, -ough, -able, …). Easily confused groups (-able and -ible, -tion and -sion, -ance and -ence) are never new at the same time.
- **A first set that finds the starting point.** A new student spells one word from each group, in order, until three are missed; groups spelled right come back later as reviews, so knowing them is shown, not assumed.

A set is at most 12 words tested (about 5 to 8 minutes): up to 10 reviews, mixed across groups, and up to 5 new words.

## What Compass gets

- One `part` report per set (`set`), with every first attempt as an item.
- A `state` report with the student's record (under 4 KB even with every word in it), and the day the next set is due, so Compass skips Spell on days with nothing to do.
- XP from the registry entry (`compass.json`): 2 XP for a set at 85% or better first time, 1 XP at 70%.

## Run it

```sh
compass app dev .        # the app beside a panel showing what Compass reads
node --test test/*.test.js   # the learning logic's tests
```

The words are in `words.js`, the logic in `spell.js`, the page in `index.html`. `compass-app.js` is the Compass helper, copied in by `compass app init`.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
