const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** IDs vindos da URL: evita levar ao banco um valor que nem é um UUID. */
export const isUuid = (value: string) => UUID.test(value);
