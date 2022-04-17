# -*- encoding: utf-8 -*-
# stub: absolute_time 1.0.0 ruby lib
# stub: ext/extconf.rb

Gem::Specification.new do |s|
  s.name = "absolute_time".freeze
  s.version = "1.0.0"

  s.required_rubygems_version = Gem::Requirement.new(">= 0".freeze) if s.respond_to? :required_rubygems_version=
  s.require_paths = ["lib".freeze]
  s.authors = ["Brian Buchanan".freeze]
  s.cert_chain = ["-----BEGIN CERTIFICATE-----\nMIIDWDCCAkCgAwIBAgIBATANBgkqhkiG9w0BAQUFADA5MQwwCgYDVQQDDANid2Ix\nFDASBgoJkiaJk/IsZAEZFgRob2xvMRMwEQYKCZImiZPyLGQBGRYDb3JnMB4XDTEz\nMDIwNjE5MzU1OVoXDTIzMDIwNDE5MzU1OVowOTEMMAoGA1UEAwwDYndiMRQwEgYK\nCZImiZPyLGQBGRYEaG9sbzETMBEGCgmSJomT8ixkARkWA29yZzCCASIwDQYJKoZI\nhvcNAQEBBQADggEPADCCAQoCggEBAKWKWUi+FyWhaDG5NUHIb0lxFkT+kfAi0NV1\neRx2I/JkNg4jzRlJF3rH8+ZtcgM8FGCY7bj+pbpXoP/2dqtXmJ7u2bjBO097xXrn\nG1pktrqZdmNCvbkQZpaXe9X61tSQJsjglrIUJvXYcIEUZ+7nD1XUrw5sPeXZ7AFI\nEp3UGHAwI5Uh3B57bzaQENJea52uPvcH246bEw3QCMXP3TK6FRWR7PU5J3eugUU5\ny7N00INs2NjnbfIrqaEC87gIpaOjMKbfTTVdSgVh2MC+sscimISsiyrayW7/IB+q\n0XP/v4s9AFEM7Yn2j2GsWHNS+vMt9xXZReYseeqoACvVZbC75EcCAwEAAaNrMGkw\nCQYDVR0TBAIwADALBgNVHQ8EBAMCBLAwHQYDVR0OBBYEFMkCi8HQi9IoAnT/qbxG\nhsWdnFK7MBcGA1UdEQQQMA6BDGJ3YkBob2xvLm9yZzAXBgNVHRIEEDAOgQxid2JA\naG9sby5vcmcwDQYJKoZIhvcNAQEFBQADggEBAGeGVOHQHUCbEt3AuhW9NcsWJHqS\nvTIp7j53LKLos4NcjpTP+Ou4kav+Wd3Kie+R/t3CpWR2ikdkMn/gQGQscCuYdYGc\n3o5CGXq40uQP4DWmkWiHDLe3w4j/Lge+78JVdHfBTjMEJpL8SjOIu3Ro0Vbl+6BV\nwPRZeEECODbxsUl/0xgloy/wE1Lov9O585H4YPFyKVl6o/OAQEwAuECqClIwyBOf\nRSzK6FH5nog+gjmernhhTI39Fevn/MXXt/mCzgo//Gd3EyYhn7jVlhAC0GWyIpJ9\nOX/k+uZl36b+q6VSxqMuBYz4vG6G5M0ajty76k23UixUOv8w3aX54VjEAyo=\n-----END CERTIFICATE-----\n".freeze]
  s.date = "2013-02-06"
  s.description = "This gem provides a monotonically increasing timer to permit safe measurement of time intervals.\n\nUsing Time.now for measuring intervals is not reliable (and sometimes unsafe) because the\nsystem clock may be stepped forwards or backwards between the two measurements, or may be\nrunning slower or faster than real time in order to effect clock synchronization with UTC.\n\nThe module uses OS-specific functions such as mach_absolute_time() and clock_gettime() to\naccess the system tick counter.  The time values returned by this module cannot be interpreted\nas real time clock values; they are only useful for comparison with another time value from\nthis module.\n".freeze
  s.email = ["bwb@holo.org".freeze]
  s.extensions = ["ext/extconf.rb".freeze]
  s.extra_rdoc_files = ["ext/absolute_time.c".freeze]
  s.files = ["ext/absolute_time.c".freeze, "ext/extconf.rb".freeze]
  s.homepage = "https://github.com/bwbuchanan/absolute_time".freeze
  s.licenses = ["BSD".freeze]
  s.rubygems_version = "3.1.2".freeze
  s.summary = "Reliable monotonically increasing timer for measuring time intervals".freeze

  s.installed_by_version = "3.1.2" if s.respond_to? :installed_by_version
end
