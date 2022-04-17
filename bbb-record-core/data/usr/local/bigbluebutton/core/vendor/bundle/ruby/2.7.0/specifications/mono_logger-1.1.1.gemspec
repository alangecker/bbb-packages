# -*- encoding: utf-8 -*-
# stub: mono_logger 1.1.1 ruby lib

Gem::Specification.new do |s|
  s.name = "mono_logger".freeze
  s.version = "1.1.1"

  s.required_rubygems_version = Gem::Requirement.new(">= 0".freeze) if s.respond_to? :required_rubygems_version=
  s.require_paths = ["lib".freeze]
  s.authors = ["Steve Klabnik".freeze]
  s.date = "2021-03-24"
  s.description = "A lock-free logger compatible with Ruby 2.0. Ruby does not allow you to request a lock in a trap handler because that could deadlock, so Logger is not sufficient.".freeze
  s.email = ["steve@steveklabnik.com".freeze]
  s.homepage = "http://github.com/steveklabnik/mono_logger".freeze
  s.licenses = ["MIT".freeze]
  s.rubygems_version = "3.1.2".freeze
  s.summary = "A lock-free logger compatible with Ruby 2.0.".freeze

  s.installed_by_version = "3.1.2" if s.respond_to? :installed_by_version

  if s.respond_to? :specification_version then
    s.specification_version = 4
  end

  if s.respond_to? :add_runtime_dependency then
    s.add_development_dependency(%q<rake>.freeze, [">= 0"])
    s.add_development_dependency(%q<minitest>.freeze, ["~> 5.0"])
  else
    s.add_dependency(%q<rake>.freeze, [">= 0"])
    s.add_dependency(%q<minitest>.freeze, ["~> 5.0"])
  end
end
