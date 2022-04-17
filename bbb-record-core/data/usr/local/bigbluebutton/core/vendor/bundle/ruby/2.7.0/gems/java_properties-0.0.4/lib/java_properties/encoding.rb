require "java_properties/utf8"
require "java_properties/specialchars"
require "java_properties/delimiters"

module JavaProperties
  
  # Classes for encoding and decoding strings for Java properties files.

  module Encoding
    
    # Encodes a string by escaping special characters (\n, \t, etc.),
    # delimiters ( =, :) and UTF-8 characters.
    
    def self.encode string
      # Replace special chars with proper \n escaped characters
      string = SpecialChars.encode(string)
      
      # Replace unescaped delimiters with proper \n escaped characters
      string = Delimiters.encode(string)
      
      # Replace UTF-8 bytes with \uXXXX encoding
      string = Utf8.encode(string)
  
      string
    end
    
    # Decodes a string by unescaping UTF-8 and special characters
    
    def self.decode string
      # Replace \uXXXX escaped chars with proper UTF-8 bytes
      string = Utf8.decode(string)
      
      # Replace \n escaped chars with proper characters
      string = SpecialChars.decode(string)
    end
     
  end
end