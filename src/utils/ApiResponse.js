// ApiResponse class is used to structure a standard response for successful API requests
class ApiResponse {
    constructor(statusCode, data, message = "Success") {
        this.statusCode = statusCode;  // HTTP status code for the response (e.g., 200, 201)
        this.data = data;  // The actual data being sent in the response
        this.message = message;  // A message describing the success (default is "Success")
        this.success = statusCode < 400;  // If statusCode is less than 400, it's a success
    }
}

export { ApiResponse };
