class TestJavaPropertiesData

def self.file1
  File.dirname(__FILE__) + '/test_files/test1.properties'
end
def self.file2
  File.dirname(__FILE__) + '/test_files/test2.properties'
end
def self.file3
  File.dirname(__FILE__) + '/test_files/test3.properties'
end
def self.file4
  File.dirname(__FILE__) + '/test_files/test4.properties'
end

def self.properties_contents1
<<-EOF;
# Comment 1
! Comment 2
item0
item1 = item1 
item2 : item2 
item3   item3

 #Comment 3
 ! Comment 4
 
 item4=item4
 item5:item5 
 item6 item6 

!Comment 4
# Comment 5

item7 = line 1 \\
        line 2 \\
        line 3

item8 : line 1 \\
line 2 \\
line 3

item9 line 1 \\
      line 2 \\
line 3

item10 test\\n\\ttest\\u0050 \\
       test\\n\\ttest \\
       test\\n\\ttest \\= test

EOF
end

def self.properties_contents2
<<-EOF;
# Comment 1
! Comment 2

item1 = item1 again 
item11 : item11
item12 : contains \\uAC00 unicode
item100=
spaces\\ x : spaces x

EOF
end

def self.properties_contents3
<<-EOF;
# with header
item100=
item2=item2
item8=line\\ 1\\ line\\ 2\\ line\\ 3
item3=item3
item9=line\\ 1\\ line\\ 2\\ line\\ 3
item4=item4
item1=item1\\ again
item10=test\\n\\ttestP\\ test\\n\\ttest\\ test\\n\\ttest\\ \\=\\ test
item5=item5
item11=item11
item6=item6
item12=contains \\uac00 unicode
spaces\\ x=spaces\\ x
item0=
item7=line\\ 1\\ line\\ 2\\ line\\ 3
EOF
end

def self.properties_contents4
<<-EOF;
# This is a test
#
# with a comment
item100=
item2=item2
item8=line\\ 1\\ line\\ 2\\ line\\ 3
item3=item3
item9=line\\ 1\\ line\\ 2\\ line\\ 3
item4=item4
item1=item1\\ again
item10=test\\n\\ttestP\\ test\\n\\ttest\\ test\\n\\ttest\\ \\=\\ test
item5=item5
item11=item11
item6=item6
item12=contains \\uac00 unicode
spaces\\ x=spaces\\ x
item0=
item7=line\\ 1\\ line\\ 2\\ line\\ 3
EOF
end

def self.content1
<<-EOF;
item0=
item1=item1
item10=test\\n\\ttestP\\ test\\n\\ttest\\ test\\n\\ttest\\ \\=\\ test
item2=item2
item3=item3
item4=item4
item5=item5
item6=item6
item7=line\\ 1\\ line\\ 2\\ line\\ 3
item8=line\\ 1\\ line\\ 2\\ line\\ 3
item9=line\\ 1\\ line\\ 2\\ line\\ 3
EOF
end

def self.content2
<<-EOF;
item0=
item1=item1\\ again
item10=test\\n\\ttestP\\ test\\n\\ttest\\ test\\n\\ttest\\ \\=\\ test
item100=
item11=item11
item12=contains\\ \\uac00\\ unicode
item2=item2
item3=item3
item4=item4
item5=item5
item6=item6
item7=line\\ 1\\ line\\ 2\\ line\\ 3
item8=line\\ 1\\ line\\ 2\\ line\\ 3
item9=line\\ 1\\ line\\ 2\\ line\\ 3
spaces\\ x=spaces\\ x
EOF
end

def self.content3
<<-EOF;
# with header
item0=
item1=item1\\ again
item10=test\\n\\ttestP\\ test\\n\\ttest\\ test\\n\\ttest\\ \\=\\ test
item100=
item11=item11
item12=contains\\ \\uac00\\ unicode
item2=item2
item3=item3
item4=item4
item5=item5
item6=item6
item7=line\\ 1\\ line\\ 2\\ line\\ 3
item8=line\\ 1\\ line\\ 2\\ line\\ 3
item9=line\\ 1\\ line\\ 2\\ line\\ 3
spaces\\ x=spaces\\ x
EOF
end

def self.content4
<<-EOF;
# This is a test
#
# with a comment
item100=
item2=item2
item8=line\\ 1\\ line\\ 2\\ line\\ 3
item3=item3
item9=line\\ 1\\ line\\ 2\\ line\\ 3
item4=item4
item1=item1\\ again
item10=test\\n\\ttestP\\ test\\n\\ttest\\ test\\n\\ttest\\ \\=\\ test
item5=item5
item11=item11
item6=item6
item12=contains \\uac00 unicode
spaces\\ x=spaces\\ x
item0=
item7=line\\ 1\\ line\\ 2\\ line\\ 3

# with spacer
item0=
item1=item1\\ again
item10=test\\n\\ttestP\\ test\\n\\ttest\\ test\\n\\ttest\\ \\=\\ test
item100=
item11=item11
item12=contains\\ \\uac00\\ unicode
item2=item2
item3=item3
item4=item4
item5=item5
item6=item6
item7=line\\ 1\\ line\\ 2\\ line\\ 3
item8=line\\ 1\\ line\\ 2\\ line\\ 3
item9=line\\ 1\\ line\\ 2\\ line\\ 3
spaces\\ x=spaces\\ x
EOF
end

end