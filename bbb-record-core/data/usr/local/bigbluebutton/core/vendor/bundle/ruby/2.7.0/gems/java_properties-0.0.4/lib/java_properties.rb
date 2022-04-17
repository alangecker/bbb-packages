$:.unshift File.dirname(__FILE__)

require 'java_properties/encoding'
require 'java_properties/properties-files'
require 'java_properties/parser'

# The JavaProperties::Properties class provides a wrapper around
# a Hash of key/value pairs that provides the ability to load
# from and save to Java properties files.

module JavaProperties

  # A class that can read and write to Java properties files that behaves
  # otherwise as a standard ruby Enumerable. The keys to this object can
  # be provided as Strings or Symbols, but internally they are Symbols.
  # 
  #   require 'rubygems'
  #   require 'java_properties'
  #   
  #   # Create a new object from a file
  #   props = JavaProperties::Properties.new("/path/to/file.properties")
  #   
  #   # Merge in another file
  #   props.load("/path/to/other/file.properties")
  #   
  #   # Behaves as an Enumerable
  #   props.each{ |key,value| puts "#{key} = #{value}" }  
  
  class Properties
  
    include Enumerable
  
    # Creates a new Properties object based on the contents
    # of a Java properties file.
  
    def self.load file
      Properties.new file
    end
    
    # Merges the contents of a Java properties file with
    # the properties already contained in this object.
    
    def load file
      @props.merge! Parser.parse( PropFile.read( file ) )
    end
    
    def initialize file
      @props = {}
      load(file)
    end
  
    # Stores the current properties into a properties file.
    # Optionally, a header comment can be provided.
  
    def store file, header = nil
      PropFile.write(file, self, header)
    end
    
    # Appends the current properties to the end of another
    # properties file. Optionally, a seperator comment
    # can be provided.
  
    def append file, seperator = nil
      PropFile.append(file, self, seperator)
    end
  
    def[](key)
      @props[key.to_sym]
    end
    
    def[]=(key,value)
      @props[key.to_sym] = value
    end
    
    def each &block
      @props.each &block
    end
    
    def keys
      @props.keys
    end
    
    # Converts the properties contained in this object into a
    # string that can be saved directly as a Java properties
    # file.
    
    def to_s
      string = ""
      # Sort to make testing easier -> output will consistent
      @props.sort_by do |key,val|
        key.to_s
      end.each do |key,val|
	string << Encoding.encode(key.to_s) << "=" << Encoding.encode(val) << "\n"
      end
      string
    end
  
  end

end