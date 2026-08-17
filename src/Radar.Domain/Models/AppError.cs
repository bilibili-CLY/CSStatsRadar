namespace Radar.Domain.Models;

public class AppError : Exception
{
    public string Code { get; }
    public int StatusCode { get; }
    public Dictionary<string, object> Extra { get; }

    public AppError(string code, int status, string? message = null, Dictionary<string, object>? extra = null)
        : base(message ?? ErrorMessages.GetValueOrDefault(code, code))
    {
        Code = code;
        StatusCode = status;
        Extra = extra ?? new Dictionary<string, object>();
    }
}

public static class AppErrors
{
    public const int StatusBadRequest = 400;
    public const int StatusNotFound = 404;
    public const int StatusConflict = 409;
    public const int StatusUnprocessable = 422;
    public const int StatusInternal = 500;

    public static AppError New(string code, int status, string? message = null, Dictionary<string, object>? extra = null)
        => new(code, status, message, extra);
}