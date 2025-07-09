# Changelog

## [4.1.0] 
- Feature: Add support for Yandex Object Storage mounts via the new `mounts` input (short syntax, e.g. `<mount-point>:<bucket>[/<prefix>][:ro]`).
- The `mounts` input now maps to Mount[] objects (with name, mode, and objectStorage fields) in the API request.
- Documentation: Added usage examples and explanation for the mounts input in README.md.
- Refactor: Modularized all parse* functions and improved test coverage for mount parsing. 
