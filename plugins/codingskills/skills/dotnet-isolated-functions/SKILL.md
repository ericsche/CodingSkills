---
name: dotnet-isolated-functions
description: Run and debug .NET-isolated Azure Functions locally. Use when a cold first request throws "A function with the id ... already exists", when function extensions fail to load under func start, or when choosing between func start and dotnet run.
license: MIT
---

# .NET-isolated Azure Functions: local dev

Practical guidance for running .NET-isolated Azure Functions on your machine.

## The cold-start double-load error

On a cold first request, `func start` can double-load functions and throw:

```
System.InvalidOperationException: Unable to load Function '...'.
A function with the id 'X' name already exists.
```

This happens when the worker process starts and initializes twice on the first
cold POST. Two reliable workarounds:

1. **Warm up with a GET first** before issuing any write/POST request.
2. **Use `dotnet run` instead of `func start`.** Core Tools itself warns:

   > Running 'func start' directly against a .NET Isolated project may not
   > correctly load function extensions. Use 'dotnet run' instead.

## Recommended local workflow

- Prefer `dotnet run` for .NET-isolated projects so extensions load correctly.
- If you must use `func start`, hit a health/GET endpoint once to warm the host
  before triggering functions that write.
- Observed with Core Tools 4.12.1 / .NET 10 isolated.

## Related tooling gotcha

- On the .NET 10 SDK, `dotnet new sln` creates an XML **`.slnx`** file (not
  `.sln`). Build and reference it by its `.slnx` name, e.g.
  `dotnet build App.slnx`. Using the `.sln` name fails with `MSB1009`.
