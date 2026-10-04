// The problem types the server answers with, for application/problem+json
// (RFC 9457): each "type" is https://…/v1/problems/{code}, and that address
// describes it. [title, usual status, what it means]

export const PROBLEMS: Record<string, [string, number, string]> = {
  validation_failed: ['Validation failed', 422, 'The body is not a valid record: "errors" names each field that is wrong and why.'],
  invalid_json: ['Invalid JSON', 400, 'The body could not be parsed as JSON.'],
  bad_request: ['Bad request', 400, 'The request is malformed; the detail says how.'],
  bad_parameter: ['Bad parameter', 400, 'A query parameter has a value of the wrong type.'],
  bad_id: ['Bad id', 400, 'Ids are whole numbers.'],
  unknown_filter: ['Unknown filter', 400, 'A query parameter names a field the collection does not have.'],
  unknown_sort: ['Unknown sort field', 400, 'sort names a field the collection does not have.'],
  unknown_field: ['Unknown field', 400, 'fields names a field the collection does not have.'],
  unknown_relation: ['Unknown relation', 400, 'expand names a relation the collection does not have.'],
  bad_cursor: ['Bad cursor', 400, 'The cursor is not one this server gave out, or it belongs to another query.'],
  not_found: ['Not found', 404, 'Nothing at this address, or no record with this id.'],
  method_not_allowed: ['Method not allowed', 405, 'The route does not take this method; the Allow header lists the ones it does.'],
  invalid_transition: ['Invalid transition', 422, 'The status cannot move from where it is to where you asked.'],
  already_liked: ['Already liked', 409, 'A user can like a post once.'],
  already_following: ['Already following', 409, 'The follow exists already.'],
  payload_too_large: ['Payload too large', 413, 'Bodies are capped at 1 MB.'],
  unauthorized: ['Unauthorized', 401, 'Credentials are missing or wrong; the WWW-Authenticate header says what is expected.'],
  forbidden: ['Forbidden', 403, 'The credentials are right but not enough for this.'],
  internal_error: ['Internal error', 500, 'Something broke on the server’s side.'],
}
