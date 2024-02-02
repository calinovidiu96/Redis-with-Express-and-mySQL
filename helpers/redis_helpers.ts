import IORedis from "ioredis";

const redisClient = new IORedis();

const DEFAULT_EXPIRATION: number = 3600;

export const getOrSetCache = <T>(
	key: string,
	cb: () => Promise<T>
): Promise<T> => {
	return new Promise<T>((resolve, reject) => {
		redisClient
			.get(key)
			.then(async (data) => {
				if (data != null) return resolve(JSON.parse(data) as T);
				const freshData: T = await cb();
				redisClient.setex(
					key,
					DEFAULT_EXPIRATION,
					JSON.stringify(freshData)
				);
				resolve(freshData);
			})
			.catch((error) => {
				reject(error);
			});
	});
};

export const clearKeysStartingWith = async (prefix: string) => {
	try {
		const keys = await redisClient.keys(`${prefix}*`);
		if (keys.length > 0) {
			await redisClient.del(...keys);
		}
	} catch (error) {
		console.error("Error clearing keys:", error);
		throw error;
	}
};
