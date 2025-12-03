using System;
using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Microsoft.eShopWeb.Infrastructure.Data;

public class QueryMonitoringInterceptor : DbCommandInterceptor
{
    private static int _basketQueryCount = 0; // Track basket queries for progressive slowdown
    private static bool _initialized = false;
    private readonly ILogger<QueryMonitoringInterceptor> _logger;

    public QueryMonitoringInterceptor(ILogger<QueryMonitoringInterceptor> logger)
    {
        _logger = logger;
        
        // Only log initialization once
        if (!_initialized)
        {
            _initialized = true;
            _logger.LogInformation("QueryMonitoringInterceptor initialized. DEBUG={Debug}, ENABLE_SLOW_BASKET={SlowBasket}", 
                Environment.GetEnvironmentVariable("DEBUG") ?? "not set",
                Environment.GetEnvironmentVariable("ENABLE_SLOW_BASKET") ?? "not set");
        }
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
            _logger.LogInformation("{Message}", message);
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
        
        // Progressive slowdown with dynamic probability
        if (isSlowBasketEnabled && containsBasketItemsInsert)
        {
            DebugLog("Detected BasketItems INSERT!");
            
            // Peek at what the delay would be (without incrementing yet)
            var nextCount = _basketQueryCount + 1;
            var potentialDelay = Math.Min(nextCount * 0.5, 15.0);
            
            // Before 10s: 75% slow, 25% fast
            // After 10s: 50% slow, 50% fast
            var randomValue = Random.Shared.Next(0, 4); // Thread-safe random
            bool shouldSlow;
            
            DebugLog($"Counter={_basketQueryCount}, potentialDelay={potentialDelay:F1}s, randomValue={randomValue}");
            
            if (potentialDelay < 10.0)
            {
                shouldSlow = randomValue < 3; // 75% slow, 25% fast
                DebugLog($"Pre-timeout phase: {(shouldSlow ? "slow (75%)" : "fast (25%)")}");
            }
            else
            {
                shouldSlow = randomValue < 2; // 50% slow, 50% fast
                DebugLog($"Timeout phase: {(shouldSlow ? "slow (50%)" : "fast (50%)")}");
            }
            
            if (shouldSlow)
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
                DebugLog("Fast path - no delay");
            }
        }
        
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }
}

