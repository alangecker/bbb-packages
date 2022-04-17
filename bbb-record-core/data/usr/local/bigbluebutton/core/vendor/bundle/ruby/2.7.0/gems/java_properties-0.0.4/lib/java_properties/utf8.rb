module JavaProperties
  
  module Encoding
    
    # Modules for encoding and decoding UTF-8 characters into ASCII
    # for Java properties files.
    #
    #   # Decode a string with UTF-8 encoded as \uXXXX (e.g. \u0050  = 'P')
    #   decoded_string = JavaProperties::Encoding::Utf8.decode( encoded_string )
    #
    #   # Encode a string so that unicode characters are escaped as \uXXXX
    #   encoded_string = JavaProperties::Encoding::Utf8.encode( decoded_string )
    #
    #   # Get the bytes that represent a given UTF-9 code point
    #   utf8_char_as_string = JavaProperties::Encoding::Utf8.utf8( code_point )
    
    module Utf8
      
      # Replaces \uXXXX escaped chars with proper UTF-8 bytes
      
      def self.decode(string)
	string.gsub!( /\\[uU]([0-9a-fA-f]{1,6})/) do |c|
	  Encoding::Utf8.utf8($1.hex)
	end
	string
      end
      
      # Gets the UTF-8 encoding of a given unicode code point (provided as an Fixnum)
      
      def self.utf8(ud)
	s = ""
	if ud < 128 then
	  # UTF-8 is 1 byte long, the value of ud.
	  s << ud
	elsif ud >= 128 && ud <= 2047 then
	  # UTF-8 is 2 bytes long.
	  s << (192 + (ud.div 64))
	  s << (128 + (ud % 64))
	elsif ud >= 2048 && ud <= 65535 then
	  # UTF-8 is 3 bytes long.
	  s << (224 + (ud.div 4096))
	  s << (128 + ((ud.div 64) % 64))
	  s << (128 + (ud % 64))
	elsif ud >= 65536 && ud <=2097151 then
	  # UTF-8 is 4 bytes long.
	  s << (240 + (ud.div 262144))
	  s << (128 + ((ud.div 4096) % 64))
	  s << (128 + ((ud.div 64) % 64))
	  s << (128 + (ud % 64))
	elsif ud >= 2097152 && ud <= 7108863 then
	  # UTF-8 is 5 bytes long.
	  s << (248 + (ud.div 16777216))
	  s << (128 + ((ud.div 262144) % 64))
	  s << (128 + ((ud.div 4096) % 64))
	  s << (128 + ((ud.div 64) % 64))
	  s << (128 + (ud % 64))
	elsif ud >= 67108864 && ud <= 2147483647
	  # then UTF-8 is 6 bytes long.
	  s << (252 + (ud.div 1073741824))
	  s << (128 + ((ud.div 16777216) % 64))
	  s << (128 + ((ud.div 262144) % 64))
	  s << (128 + ((ud.div 4096) % 64))
	  s << (128 + ((ud.div 64) % 64))
	  s << (128 + (ud % 64))
	end
	s
      end
    
      # Encodes all UTF-8 characters in the provided string using \uXXXX
      # format.
      
      def self.encode(string)
	s = ""
	chars = string.split( // )
	while(chars.size > 0) do
	  z = chars.shift[0].to_i
	  if z >= 0 && z <= 127 then
	    # 1 byte -- essentially ascii
	    s << z
	  elsif z >= 192 && z <= 223 then
	    # 2 bytes
	    y = chars.shift[0].to_i
	    s << "\\u#{sprintf('%02x',( (z-192)*64 + (y-128) ))}"
	  elsif z >= 224 && z <= 239 then
	    # 3 bytes
	    y = chars.shift[0].to_i
	    x = chars.shift[0].to_i
	    s << "\\u#{sprintf('%04x',( (z-224)*4096 + (y-128)*64 + (x-128) ))}"
	  elsif z >= 240 && z <= 247 then
	    # 4 bytes
	    y = chars.shift[0].to_i
	    x = chars.shift[0].to_i
	    w = chars.shift[0].to_i
	    s << "\\u#{sprintf('%06x',( (z-240)*262144 + (y-128)*4096 + (x-128)*64 + (w-128) ))}"
	  elsif z >= 248 && z <= 251 then
	    # 5 bytes
	    y = chars.shift[0].to_i
	    x = chars.shift[0].to_i
	    w = chars.shift[0].to_i
	    v = chars.shift[0].to_i
	    s << "\\u#{sprintf('%08x',( (z-248)*16777216 + (y-128)*262144 + (x-128)*4096 + (w-128)*64 + (v-128) ))}"
	  elsif z >= 252 && z <= 253 then
	    # 6 bytes
	    y = chars.shift[0].to_i
	    x = chars.shift[0].to_i
	    w = chars.shift[0].to_i
	    v = chars.shift[0].to_i
	    u = chars.shift[0].to_i
	    s << "\\u#{sprintf('%010x',( (z-252)*1073741824 + (y-128)*16777216 + (x-128)*262144 + (w-128)*4096 + (v-128)*64 + (u-128) ))}"
	  else
	    s << z
	  end
	end
	s
      end  
    end
  
  end
end