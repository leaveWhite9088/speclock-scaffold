.PHONY: check check-security test-live

check-security:
	node scripts/check-security.mjs

check: check-security
	npm run test:ci

test-live:
	npm test
