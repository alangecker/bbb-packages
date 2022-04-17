= Java Properties Files in Ruby

I don't know if there's a real need for this, and if there is the jruby
people probably have it covered a lot better than I do. These classes
were mainly whipped up as an exercise in creating a ruby gem.

= JavaProperties::Properties

A class that can read and write to Java properties files that behaves
otherwise as a standard ruby Enumerable. The keys to this object can
be provided as Strings or Symbols, but internally they are Symbols.

  require 'rubygems'
  require 'java_properties'
  
  # Create a new object from a file
  props = JavaProperties::Properties.new("/path/to/file.properties")
  
  # Merge in another file
  props.load("/path/to/other/file.properties")
  
  # Behaves as an Enumerable
  props.each{ |key,value| puts "#{key} = #{value}" }

= properties2yaml

An executable script to convert an existing properties file to a YAML
file. There is no script to go the other way because not all YAML
files can be saved into a properties file. (That and I was feeling lazy.)
 
  Usage: properties2yaml [options] [INPUT] [OUTPUT]
  
  Options are:
  
      -s, --stdin  Read input from standard input instead of an input file
      -h, --help   Show this help message.
