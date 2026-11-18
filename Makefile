.PHONY: check check-security bench test-live

check-security:
	node scripts/check-security.mjs

check: check-security
	npm run test:ci

bench:
	node scripts/bench.mjs

test-live:
	npm test
