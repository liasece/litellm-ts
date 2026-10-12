/**
 * Transfer a deployment slot to an async iterator, including cancellation before its first next().
 * @template T - Result type
 * @param result
 * @param release
 */
export function trackIteratorLifetime<T>(result: T, release: () => void): T {
	if (!result || typeof result !== "object" || !(Symbol.asyncIterator in result)) {
		release();
		return result;
	}
	const inner = result as AsyncIterable<unknown>;
	const wrapped = (async function* () {
		try {
			for await (const chunk of inner) {
				yield chunk;
			}
		} finally {
			release();
		}
	})();
	const finish = wrapped.return.bind(wrapped);
	wrapped.return = async (value) => {
		release();
		try {
			const iterator = inner[Symbol.asyncIterator]();
			await iterator.return?.();
			return await finish(value);
		} finally {
			release();
		}
	};
	return wrapped as T;
}
