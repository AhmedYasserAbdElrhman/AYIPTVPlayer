/**
 * Login form validator.
 * Pure logic: no DOM or UI side effects.
 */

/**
 * Validates login form fields.
 *
 * @param {{ host: string, port: string, username: string, password: string }} values
 * @returns {{ isValid: boolean, errors: { host?: boolean, port?: boolean, username?: boolean, password?: boolean } }}
 */
export function validateLogin(values) {
    const errors = {};

    const trimmed = {
        host: (values.host || '').trim(),
        port: (values.port || '').trim(),
        username: (values.username || '').trim(),
        password: values.password || '',
    };

    if (!trimmed.host) errors.host = true;
    if (!trimmed.port) errors.port = true;
    if (!trimmed.username) errors.username = true;
    if (!trimmed.password) errors.password = true;

    const isValid = Object.keys(errors).length === 0;
    return { isValid, errors };
}

