// ApiError class extends the default JavaScript Error class to provide custom error handling
class ApiError extends Error {
    constructor(
        statusCode,  // HTTP status code for the error (e.g., 404, 500)
        message = "Something went wrong!",  // Error message to be displayed
        errors = [],  // Additional error details, usually an array of validation errors
        stack = ""  // Error stack trace, if provided
    ) {
        super(); // Call the parent class's constructor (Error)
        
        // Assign the statusCode and message properties to the error object
        this.statusCode = statusCode;
        this.data = null;  // Optional data, can be set later if needed
        this.message = message;
        this.success = false;  // Indicates that this is an error, so success is false
        this.errors = errors;

        // Set the stack trace for debugging
        if (stack) {
            this.stack = stack;  // If a stack trace is provided, use it
        } else {
            Error.captureStackTrace(this, this.constructor);  // Otherwise, capture the current stack trace
        }
    }
}

export { ApiError };
