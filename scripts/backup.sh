#!/usr/bin/env bash
# Back up Buildagon to its public GitHub repo, github.com/plasticmind/game-buildagon.
#
#   npm run backup               push every arcade commit on main that changed this folder
#   npm run backup -- --dry-run  list what would be pushed, and stop
#
# The arcade repo has no remote, and its history holds every game, so this replays
# only this folder. It finds the arcade commit whose copy of this folder matches
# GitHub's main, then, for each later commit on the arcade's main that changed the
# folder, makes a commit on top of GitHub's main with the same message (minus the
# "Buildagon: " prefix), author, date, and folder contents. Every push is a
# fast-forward, so GitHub's history only grows. Uncommitted work isn't backed up.
set -euo pipefail

REPO_URL="https://github.com/plasticmind/game-buildagon.git"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    *) echo "error: unknown option: $arg (try --dry-run)" >&2; exit 1 ;;
  esac
done

cd "$(dirname "${BASH_SOURCE[0]}")/.."
prefix="$(git rev-parse --show-prefix)"
prefix="${prefix%/}"
[[ -n "$prefix" ]] || { echo "error: this folder must sit inside the arcade repo" >&2; exit 1; }

if [[ -n "$(git status --porcelain -- .)" ]]; then
  echo "warning: $prefix/ has uncommitted changes. Only commits on main are backed up." >&2
fi

git fetch --quiet "$REPO_URL" main
remote="$(git rev-parse FETCH_HEAD)"
remote_tree="$(git rev-parse "$remote^{tree}")"

# The newest arcade commit that GitHub's main already matches.
base=""
while read -r c; do
  if [[ "$(git rev-parse -q --verify "$c:$prefix" || true)" == "$remote_tree" ]]; then
    base="$c"
    break
  fi
done < <(git rev-list main -- .)
if [[ -z "$base" ]]; then
  echo "error: GitHub's main doesn't match any version of $prefix/ on the arcade's main." >&2
  echo "Someone may have pushed to GitHub directly. Compare the two by hand before backing up." >&2
  exit 1
fi

todo="$(git rev-list --reverse "$base..main" -- .)"
if [[ -z "$todo" ]]; then
  echo "GitHub is up to date with $prefix/ at $(git rev-parse --short "$base")."
  exit 0
fi

if (( DRY_RUN )); then
  echo "Would push these arcade commits to $REPO_URL:"
  # shellcheck disable=SC2086
  git log --no-walk=unsorted --format='  %h %s' $todo
  exit 0
fi

head="$remote"
count=0
for c in $todo; do
  tree="$(git rev-parse "$c:$prefix")"
  [[ "$tree" == "$(git rev-parse "$head^{tree}")" ]] && continue
  # Drop the arcade's "Buildagon: " prefix and capitalize what's left.
  msg="$(git log -1 --format=%B "$c" | sed -E '1s/^Buildagon: *//' | awk 'NR == 1 { $0 = toupper(substr($0, 1, 1)) substr($0, 2) } { print }')"
  head="$(
    GIT_AUTHOR_NAME="$(git log -1 --format=%an "$c")" \
      GIT_AUTHOR_EMAIL="$(git log -1 --format=%ae "$c")" \
      GIT_AUTHOR_DATE="$(git log -1 --format=%aI "$c")" \
      git commit-tree "$tree" -p "$head" -F - <<< "$msg"
  )"
  count=$((count + 1))
done

# A merge can leave the folder in a state no single commit had. Catch up if so.
final="$(git rev-parse "main:$prefix")"
if [[ "$(git rev-parse "$head^{tree}")" != "$final" ]]; then
  head="$(git commit-tree "$final" -p "$head" -m "Sync with the family arcade")"
  count=$((count + 1))
fi

if (( count == 0 )); then
  echo "GitHub is up to date with $prefix/."
  exit 0
fi
git push --quiet "$REPO_URL" "$head:refs/heads/main"
echo "Pushed $count commit(s) to $REPO_URL. GitHub's main is now $(git rev-parse --short "$head")."
