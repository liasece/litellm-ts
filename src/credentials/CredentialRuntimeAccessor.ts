/** 运行期明文凭据。 */
export type RuntimeCredential = Readonly<{
	/** 唯一凭据名称。 */
	credential_name: string;
	/** 运行时明文凭据值。 */
	credential_values: Record<string, unknown>;
	/** 非秘密元数据。 */
	credential_info: Record<string, unknown>;
}>;

/** 以实例级 Map 保存运行期凭据，并隔离调用方修改。 */
export class CredentialRuntimeAccessor {
	private readonly _credentials = new Map<string, RuntimeCredential>();

	/**
	 * 原子替换全部运行期凭据。
	 * @param credentials
	 */
	replaceAll(credentials: readonly RuntimeCredential[]): void {
		const replacement = new Map<string, RuntimeCredential>();
		for (const credential of credentials) {
			replacement.set(credential.credential_name, this._copy(credential));
		}
		this._credentials.clear();
		for (const [name, credential] of replacement) {
			this._credentials.set(name, credential);
		}
	}

	/**
	 * 新增或替换一个运行期凭据。
	 * @param credential
	 */
	upsert(credential: RuntimeCredential): void {
		this._credentials.set(credential.credential_name, this._copy(credential));
	}

	/**
	 * 删除指定凭据并返回是否存在。
	 * @param credentialName
	 */
	remove(credentialName: string): boolean {
		return this._credentials.delete(credentialName);
	}

	/**
	 * 返回凭据副本；不存在时返回 undefined。
	 * @param credentialName
	 */
	get(credentialName: string): RuntimeCredential | undefined {
		const credential = this._credentials.get(credentialName);
		return credential === undefined ? undefined : this._copy(credential);
	}

	/**
	 * 返回凭据值副本；不存在时返回 undefined。
	 * @param credentialName
	 */
	getValues(credentialName: string): Record<string, unknown> | undefined {
		const values = this._credentials.get(credentialName)?.credential_values;
		return values === undefined ? undefined : structuredClone(values);
	}

	private _copy(credential: RuntimeCredential): RuntimeCredential {
		return {
			credential_name: credential.credential_name,
			credential_values: structuredClone(credential.credential_values),
			credential_info: structuredClone(credential.credential_info),
		};
	}
}
