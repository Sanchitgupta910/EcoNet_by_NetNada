// asyncHandler function takes a request handler as input and returns a function
const asyncHandler = (requestHandler) => {

    // Returns a new function that takes req, res, and next (standard Express arguments)
    return (req, res, next) => {

        // Wraps the requestHandler in a Promise, and if it fails, the error is caught
        // and passed to the next middleware using 'next' (error handling middleware)
        
        Promise.resolve(requestHandler(req, res, next)).catch((err) => next(err));
    };
};

export { asyncHandler };
