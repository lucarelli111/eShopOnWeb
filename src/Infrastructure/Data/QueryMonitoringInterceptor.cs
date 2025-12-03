using System;
using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Microsoft.eShopWeb.Infrastructure.Data;

public class QueryMonitoringInterceptor : DbCommandInterceptor
{
    private static readonly Random _random = new Random();
    private static int _basketQueryCount = 0; // Track basket queries for progressive slowdown
    private readonly ILogger<QueryMonitoringInterceptor> _logger;

    public QueryMonitoringInterceptor(ILogger<QueryMonitoringInterceptor> logger)
    {
        _logger = logger;
    }
    
    private bool IsDebugEnabled()
    {
        var envValue = Environment.GetEnvironmentVariable("DEBUG");
        return !string.IsNullOrEmpty(envValue) && 
               (envValue.Equals("true", StringComparison.OrdinalIgnoreCase) || envValue == "1");
    }
    
    private void DebugLog(string message)
    {
        if (IsDebugEnabled())
        {
            _logger.LogDebug("{Message}", message);
        }
    }
    
    private static bool IsSlowBasketEnabled()
    {
        var envValue = Environment.GetEnvironmentVariable("ENABLE_SLOW_BASKET");
        return !string.IsNullOrEmpty(envValue) && 
               (envValue.Equals("true", StringComparison.OrdinalIgnoreCase) || envValue == "1");
    }
    
    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        var queryPreview = command.CommandText.Substring(0, Math.Min(100, command.CommandText.Length));
        DebugLog($"ReaderExecutingAsync called. Query preview: {queryPreview}...");
        
        // Check for INSERT into BasketItems (EF Core uses ExecuteReader for INSERTs to get the generated ID)
        var containsBasketItemsInsert = command.CommandText.Contains("[BasketItems]") && command.CommandText.Contains("INSERT");
        var isSlowBasketEnabled = IsSlowBasketEnabled();
        
        DebugLog($"BasketItems INSERT check: contains={containsBasketItemsInsert}, slowBasketEnabled={isSlowBasketEnabled}");
        
        // Progressive slowdown with randomization
        if (isSlowBasketEnabled && containsBasketItemsInsert)
        {
            DebugLog("Detected BasketItems INSERT!");
            
            // 75% chance to apply slowdown (3 out of 4 requests)
            var randomValue = _random.Next(0, 4);
            
            if (randomValue < 3) // 0, 1, 2 = slow (75%), 3 = fast (25%)
            {
                // Increment counter to track progression
                var currentCount = Interlocked.Increment(ref _basketQueryCount);
                
                // Progressive delay: increases by 0.5s per insert up to 15s
                var delaySeconds = Math.Min(currentCount * 0.5, 15.0);
                
                DebugLog($"Insert #{currentCount} → {delaySeconds:F1}s delay (timeout at 10s)");
                
                // Convert to time format for WAITFOR DELAY
                var timeSpan = TimeSpan.FromSeconds(delaySeconds);
                var waitForTime = $"{timeSpan.Hours:D2}:{timeSpan.Minutes:D2}:{timeSpan.Seconds:D2}.{timeSpan.Milliseconds:D3}";
                
                // Append WAITFOR at the end
                command.CommandText = $"{command.CommandText}; WAITFOR DELAY '{waitForTime}'";
                DebugLog($"Applied WAITFOR DELAY '{waitForTime}'");
            }
            else
            {
                DebugLog("Fast path - no delay (25% of requests)");
            }
        }
        
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }
}

