---
title: Design Patterns
description: "Local design pattern reference."
---

# Design Patterns

## What's a design pattern?

Type: Design Pattern Reference

### Overview

- Design patterns are typical solutions to commonly occurring problems in software design. They are like pre-made blueprints that you can customize to solve a recurring design problem in your code.
- You can’t just find a pattern and copy it into your program, the way you can with off-the-shelf functions or libraries. The pattern is not a specific piece of code, but a general concept for solving a particular problem. You can follow the pattern details and implement a solution that suits the realities of your own program.
- Patterns are often confused with algorithms, because both concepts describe typical solutions to some known problems. While an algorithm always defines a clear set of actions that can achieve some goal, a pattern is a more high-level description of a solution. The code of the same pattern applied to two different programs may be different.
- An analogy to an algorithm is a cooking recipe: both have clear steps to achieve a goal. On the other hand, a pattern is more like a blueprint: you can see what the result and its features are, but the exact order of implementation is up to you.

### What does the pattern consist of?

- Most patterns are described very formally so people can reproduce them in many contexts. Here are the sections that are usually present in a pattern description:
- Intent of the pattern briefly describes both the problem and the solution.
- Motivation further explains the problem and the solution the pattern makes possible.
- Structure of classes shows each part of the pattern and how they are related.
- Code example in one of the popular programming languages makes it easier to grasp the idea behind the pattern.
- Some pattern catalogs list other useful details, such as applicability of the pattern, implementation steps and relations with other patterns.

## Classification of patterns

Type: Design Pattern Reference

### Overview

- Design patterns differ by their complexity, level of detail and scale of applicability to the entire system being designed. I like the analogy to road construction: you can make an intersection safer by either installing some traffic lights or building an entire multi-level interchange with underground passages for pedestrians.
- The most basic and low-level patterns are often called idioms . They usually apply only to a single programming language.
- The most universal and high-level patterns are architectural patterns . Developers can implement these patterns in virtually any language. Unlike other patterns, they can be used to design the architecture of an entire application.
- In addition, all patterns can be categorized by their intent , or purpose. This book covers three main groups of patterns:
- Creational patterns provide object creation mechanisms that increase flexibility and reuse of existing code.
- Structural patterns explain how to assemble objects and classes into larger structures, while keeping these structures flexible and efficient.
- Behavioral patterns take care of effective communication and the assignment of responsibilities between objects.

## The Catalog of Design Patterns

Type: Design Pattern Reference

### Creational patterns

- These patterns provide various object creation mechanisms, which increase flexibility and reuse of existing code.

References:

- [Factory Method](#creational-patterns)
- [Abstract Factory](#creational-patterns)
- Builder
- Prototype
- Singleton

### Structural patterns

- These patterns explain how to assemble objects and classes into larger structures while keeping these structures flexible and efficient.

References:

- Adapter
- Bridge
- Composite
- [Decorator](#structural-patterns)
- Facade
- Flyweight
- [Proxy](#structural-patterns)

### Behavioral patterns

- These patterns are concerned with algorithms and the assignment of responsibilities between objects.

References:

- Chain of Responsibility
- Command
- Iterator
- Mediator
- Memento
- Observer
- State
- [Strategy](#behavioral-patterns)
- Template Method
- [Visitor](#behavioral-patterns)
